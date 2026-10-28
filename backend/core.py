from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta, date
from fastapi import Request, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger("devrantas")

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

OVERHEAD_RATE = 0.06
JWT_ALGORITHM = "HS256"
ROLES = ("yonetici", "santiye_sefi", "muhasebe")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return date.today().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def r2(v: float) -> float:
    return round(float(v or 0), 2)


# ---------- Auth ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role,
               "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def set_auth_cookies(response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name", ""), "role": u.get("role", "muhasebe"),
            "created_at": u.get("created_at")}


async def get_current_user(request: Request) -> dict:
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Oturum açılmamış")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Oturum süresi doldu")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Geçersiz oturum")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Geçersiz token tipi")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    return public_user(user)


def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Bu işlem için yetkiniz yok")
        return user
    return checker


# ---------- Yetki matrisi (yönetici belirler) ----------
PERMISSIONS = {
    "edit_transactions": "Gelir/gider kaydını düzenleme",
    "delete_transactions": "Gelir/gider kaydını silme",
    "approve_expenses": "Gider onaylama / reddetme",
    "edit_progress": "Hakediş düzenleme",
    "edit_sites": "Şantiye düzenleme",
    "edit_accounts": "Cari (müşteri/taşeron) düzenleme",
    "edit_checks": "Çek düzenleme / ciro",
    "view_reports": "Raporları görme",
}
DEFAULT_PERMISSIONS = {
    "muhasebe": {"edit_transactions": True, "delete_transactions": False, "approve_expenses": False, "edit_progress": True, "edit_sites": False, "edit_accounts": True, "edit_checks": True, "view_reports": True},
    "santiye_sefi": {"edit_transactions": True, "delete_transactions": False, "approve_expenses": False, "edit_progress": True, "edit_sites": True, "edit_accounts": False, "edit_checks": False, "view_reports": False},
}
_perm_cache = {"doc": None}


async def get_permissions() -> dict:
    if _perm_cache["doc"] is None:
        doc = await db.settings.find_one({"id": "permissions"}, {"_id": 0}) or {}
        merged = {r: {**DEFAULT_PERMISSIONS[r], **(doc.get(r) or {})} for r in DEFAULT_PERMISSIONS}
        _perm_cache["doc"] = merged
    return _perm_cache["doc"]


def invalidate_permissions():
    _perm_cache["doc"] = None


async def user_permissions(user: dict) -> dict:
    if user.get("role") == "yonetici":
        return {k: True for k in PERMISSIONS}
    perms = await get_permissions()
    return perms.get(user.get("role"), {k: False for k in PERMISSIONS})


def require_perm(key: str):
    async def checker(user: dict = Depends(get_current_user)):
        perms = await user_permissions(user)
        if not perms.get(key):
            raise HTTPException(status_code=403, detail=f"Bu işlem için yetkiniz yok ({PERMISSIONS.get(key, key)}). Yönetici yetki verebilir.")
        return user
    return checker


# ---------- Object Storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "devrantas-erp"
_storage_key = None


def init_storage(force: bool = False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- Finance helpers ----------
SUB_CATEGORIES = ("Taşeron Hakediş Ödemesi", "Taşeron Avansı")


async def _sum(coll, match, field="amount"):
    r = await db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "t": {"$sum": f"${field}"}}}]).to_list(1)
    return float(r[0]["t"]) if r else 0.0


async def site_summary(site: dict) -> dict:
    sid = site["id"]
    income = await _sum("transactions", {"site_id": sid, "status": "onaylandi", "type": "gelir"})
    direct_expense = await _sum("transactions", {"site_id": sid, "status": "onaylandi", "type": "gider", "category": {"$nin": list(SUB_CATEGORIES)}})
    sub_expense = await _sum("progress_payments", {"site_id": sid, "type": "taseron", "status": {"$in": ["onaylandi", "odendi"]}}, "net_amount")
    pending_total = await _sum("transactions", {"site_id": sid, "status": "onay_bekliyor", "type": "gider", "category": {"$nin": list(SUB_CATEGORIES)}})
    sub_paid = await _sum("transactions", {"site_id": sid, "status": "onaylandi", "type": "gider", "category": {"$in": list(SUB_CATEGORIES)}})
    contract = float(site.get("contract_amount") or 0)
    overhead = contract * OVERHEAD_RATE
    net_contract = contract - overhead
    expense = direct_expense + sub_expense
    est_profit = net_contract - expense
    realized_overhead = income * OVERHEAD_RATE
    realized_profit = income - realized_overhead - expense
    progress = float(site.get("progress_percent") or 0)
    budget_used = (expense / net_contract * 100) if net_contract else 0
    return {
        "contract_amount": r2(contract), "overhead_rate": OVERHEAD_RATE, "overhead_amount": r2(overhead),
        "net_contract": r2(net_contract), "total_income": r2(income), "total_expense": r2(expense),
        "direct_expense": r2(direct_expense), "subcontractor_expense": r2(sub_expense), "subcontractor_paid": r2(sub_paid),
        "pending_expense": r2(pending_total), "estimated_profit": r2(est_profit),
        "profit_margin": r2(est_profit / contract * 100) if contract else 0,
        "realized_profit": r2(realized_profit), "realized_overhead": r2(realized_overhead),
        "collection_rate": r2(income / contract * 100) if contract else 0,
        "budget_used_percent": r2(budget_used), "progress_percent": progress,
        "deviation": r2(budget_used - progress),
    }


async def account_balance(account: dict) -> dict:
    aid = account["id"]
    hak_total = await _sum("progress_payments", {"account_id": aid, "status": {"$in": ["onaylandi", "odendi"]}}, "net_amount")
    ttype = "gelir" if account.get("type") == "musteri" else "gider"
    pay_total = await _sum("transactions", {"account_id": aid, "status": "onaylandi", "type": ttype})
    advance = await _sum("transactions", {"account_id": aid, "status": "onaylandi", "type": ttype, "category": {"$in": ["Taşeron Avansı", "Avans"]}})
    nakit = await _sum("transactions", {"account_id": aid, "status": "onaylandi", "type": ttype, "kasa": "nakit"})
    cek = await _sum("transactions", {"account_id": aid, "status": "onaylandi", "type": ttype, "kasa": "cek"})
    diff = r2(hak_total - pay_total)
    is_customer = account.get("type") == "musteri"
    return {"total_progress": r2(hak_total), "total_paid": r2(pay_total), "advance_total": r2(pay_total if not is_customer else advance),
            "paid_nakit": r2(nakit), "paid_cek": r2(cek), "balance": diff,
            # Taşeron: hakediş alacak, tüm ödemeler avans/borç → diff>0 taşerona borcumuz, diff<0 taşeron avans borçlusu
            # Müşteri: hakediş borç, tahsilat alacak → diff>0 müşteriden alacağımız, diff<0 müşteri alacaklı (fazla tahsilat)
            "we_owe": r2(max(diff, 0)) if not is_customer else 0.0,
            "advance_outstanding": r2(max(-diff, 0)) if not is_customer else 0.0,
            "receivable": r2(max(diff, 0)) if is_customer else 0.0,
            "customer_credit": r2(max(-diff, 0)) if is_customer else 0.0}
