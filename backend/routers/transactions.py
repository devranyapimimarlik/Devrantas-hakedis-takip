from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from core import db, get_current_user, require_perm, new_id, now_iso
from routers.push import send_push
from pymongo.errors import DuplicateKeyError


def tl(v) -> str:
    return f"{float(v or 0):,.0f} ₺".replace(",", ".")

router = APIRouter(prefix="/transactions", tags=["transactions"])

EXPENSE_CATEGORIES = ["Taşeron Hakediş Ödemesi", "Taşeron Avansı", "Malzeme", "Nakliye", "Tedarikçi", "İşçilik", "Makine/Ekipman",
                      "Kira", "Yakıt", "Vergi/Harç", "Genel Gider", "Diğer"]
INCOME_CATEGORIES = ["Hakediş Tahsilatı", "Avans", "Diğer"]
SUB_CATEGORIES = ("Taşeron Hakediş Ödemesi", "Taşeron Avansı")
KASALAR = {"nakit": "Devrantaş Nakit", "cek": "Devrantaş Çek"}


class TransactionIn(BaseModel):
    site_id: Optional[str] = None
    account_id: Optional[str] = None
    type: str  # gelir | gider
    category: str = "Diğer"
    amount: float
    date: str
    description: Optional[str] = ""
    kasa: str  # nakit | cek
    attachment_file_id: Optional[str] = None
    check_due_date: Optional[str] = None
    client_key: Optional[str] = None
    check_bank: Optional[str] = ""
    check_no: Optional[str] = ""


class RejectIn(BaseModel):
    reason: Optional[str] = ""


@router.get("/categories")
async def categories(user=Depends(get_current_user)):
    return {"gider": EXPENSE_CATEGORIES, "gelir": INCOME_CATEGORIES, "kasalar": KASALAR}


@router.get("/kasa")
async def kasa_balances(user=Depends(get_current_user)):
    rows = await db.transactions.aggregate([{"$match": {"status": "onaylandi"}},
                                            {"$group": {"_id": {"kasa": "$kasa", "type": "$type"}, "t": {"$sum": "$amount"}}}]).to_list(20)
    out = {k: {"name": v, "gelir": 0.0, "gider": 0.0} for k, v in KASALAR.items()}
    for r in rows:
        k = r["_id"].get("kasa") or "nakit"
        out.setdefault(k, {"name": k, "gelir": 0.0, "gider": 0.0})[r["_id"]["type"]] += r["t"]
    for k in out:
        out[k]["balance"] = round(out[k]["gelir"] - out[k]["gider"], 2)
    out["toplam"] = round(sum(v["balance"] for v in out.values()), 2)
    return out


async def _enrich(t: dict, sites: dict, accounts: dict) -> dict:
    t["site_name"] = sites.get(t.get("site_id"))
    t["account_name"] = accounts.get(t.get("account_id"))
    return t


async def _lookups():
    sites = {s["id"]: s["name"] async for s in db.sites.find({}, {"_id": 0, "id": 1, "name": 1})}
    accounts = {a["id"]: a["name"] async for a in db.accounts.find({}, {"_id": 0, "id": 1, "name": 1})}
    return sites, accounts


@router.get("")
async def list_transactions(site_id: Optional[str] = None, type: Optional[str] = None,
                            status: Optional[str] = None, account_id: Optional[str] = None,
                            user=Depends(get_current_user)):
    q = {}
    if site_id: q["site_id"] = site_id
    if type: q["type"] = type
    if status: q["status"] = status
    if account_id: q["account_id"] = account_id
    rows = await db.transactions.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(2000)
    sites, accounts = await _lookups()
    return [await _enrich(t, sites, accounts) for t in rows]


@router.post("", status_code=201)
async def create_transaction(data: TransactionIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if data.type not in ("gelir", "gider"):
        raise HTTPException(status_code=400, detail="Tip gelir veya gider olmalı")
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı")
    if data.kasa not in KASALAR:
        raise HTTPException(status_code=400, detail="Kasa seçimi zorunlu (nakit veya çek)")
    if data.category in SUB_CATEGORIES and not data.account_id:
        raise HTTPException(status_code=400, detail="Taşeron ödemesi için taşeron seçilmeli")
    if data.client_key:
        existing = await db.transactions.find_one({"client_key": data.client_key, "created_by": user["id"]}, {"_id": 0})
        if existing:
            sites, accounts = await _lookups()
            return await _enrich(existing, sites, accounts)
    else:
        data.client_key = None
    status = "onaylandi" if data.type == "gelir" else "onay_bekliyor"
    doc = {"id": new_id(), **data.model_dump(), "status": status, "created_by": user["id"],
           "created_by_name": user["name"], "created_at": now_iso(), "approved_by": None, "approved_at": None,
           "reject_reason": None, "check_id": None}
    if data.type == "gelir":
        doc["approved_by"] = user["id"]
        doc["approved_at"] = now_iso()
        doc["approved_by_name"] = user["name"]
    if data.kasa == "cek" and data.check_due_date:
        from routers.checks import create_reminders
        chk = {"id": new_id(), "direction": "alinan" if data.type == "gelir" else "verilen", "account_id": data.account_id,
               "site_id": data.site_id, "bank": data.check_bank or "", "check_no": data.check_no or "", "drawer": "",
               "amount": data.amount, "issue_date": data.date, "due_date": data.check_due_date, "image_file_id": data.attachment_file_id,
               "notes": data.description or "", "status": "portfoyde", "created_at": now_iso(), "created_by": user["id"], "transaction_id": doc["id"]}
        await db.checks.insert_one(chk)
        label = "Alınan Çek" if chk["direction"] == "alinan" else "Verilen Çek"
        await create_reminders("cek", chk["id"], f"{label} - {chk['bank']} {chk['check_no']}".strip(), data.amount, data.check_due_date)
        doc["check_id"] = chk["id"]
    try:
        await db.transactions.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.transactions.find_one({"client_key": data.client_key, "created_by": user["id"]}, {"_id": 0})
        sites, accounts = await _lookups()
        return await _enrich(existing, sites, accounts)
    doc.pop("_id", None)
    sites, accounts = await _lookups()
    enriched = await _enrich(doc, sites, accounts)
    if status == "onay_bekliyor":
        site_name = enriched.get("site_name") or "Genel"
        background.add_task(send_push, None, "Onay bekleyen gider", f"{tl(data.amount)} · {data.category} · {site_name} — {user['name']}", "/islemler?tab=onay", f"tx-{doc['id']}", ["yonetici"])
    return enriched


class TransactionEdit(BaseModel):
    category: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[str] = None
    description: Optional[str] = None
    kasa: Optional[str] = None
    site_id: Optional[str] = None
    account_id: Optional[str] = None
    attachment_file_id: Optional[str] = None
    check_due_date: Optional[str] = None
    check_bank: Optional[str] = None
    check_no: Optional[str] = None


@router.put("/{tx_id}")
async def update_transaction(tx_id: str, data: TransactionEdit, background: BackgroundTasks, user=Depends(require_perm("edit_transactions"))):
    t = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="İşlem bulunamadı")
    if t.get("endorsed"):
        raise HTTPException(status_code=400, detail="Çek ciro işlemi düzenlenemez; silip yeniden ciro edin")
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    if "amount" in upd and upd["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı")
    if "kasa" in upd and upd["kasa"] not in ("nakit", "cek"):
        raise HTTPException(status_code=400, detail="Kasa nakit veya çek olmalı")
    for k in ("site_id", "account_id", "attachment_file_id", "check_due_date", "description"):
        if k in data.model_fields_set and getattr(data, k) in ("", None):
            upd[k] = None if k != "description" else ""
    cats = INCOME_CATEGORIES if t["type"] == "gelir" else EXPENSE_CATEGORIES
    if "category" in upd and upd["category"] not in cats:
        raise HTTPException(status_code=400, detail="Geçersiz kategori")
    changed = {k: v for k, v in upd.items() if t.get(k) != v}
    if not changed:
        sites, accounts = await _lookups()
        return await _enrich(t, sites, accounts)
    changed.update({"edited_by": user["id"], "edited_by_name": user["name"], "edited_at": now_iso(),
                    "edit_log": (t.get("edit_log") or [])[-19:] + [{"at": now_iso(), "by": user["name"], "before": {k: t.get(k) for k in changed}}]})
    money_fields = {"amount", "kasa", "category", "account_id", "site_id", "date"}
    reapprove = t["type"] == "gider" and user["role"] != "yonetici" and t.get("status") == "onaylandi" and bool(money_fields & set(changed))
    if reapprove:
        changed.update({"status": "onay_bekliyor", "approved_by": None, "approved_by_name": None, "approved_at": None})
    await db.transactions.update_one({"id": tx_id}, {"$set": changed})
    if t.get("check_id"):
        cupd = {}
        if "amount" in changed: cupd["amount"] = changed["amount"]
        if "check_due_date" in changed and changed["check_due_date"]: cupd["due_date"] = changed["check_due_date"]
        if "check_bank" in changed: cupd["bank"] = changed["check_bank"]
        if "check_no" in changed: cupd["check_no"] = changed["check_no"]
        if cupd:
            await db.checks.update_one({"id": t["check_id"]}, {"$set": cupd})
            if "due_date" in cupd:
                await db.reminders.update_many({"source_id": t["check_id"]}, {"$set": {"due_date": cupd["due_date"]}})
    if t.get("progress_payment_id"):
        from routers.progress import close_if_paid
        await close_if_paid(t["progress_payment_id"])
    if reapprove:
        background.add_task(send_push, None, "Düzenlenen gider onay bekliyor", f"{tl(changed.get('amount', t['amount']))} · {changed.get('category', t['category'])} — {user['name']}", "/islemler?tab=onay", f"tx-{tx_id}", ["yonetici"])
    doc = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    sites, accounts = await _lookups()
    return await _enrich(doc, sites, accounts)


@router.post("/{tx_id}/approve")
async def approve(tx_id: str, background: BackgroundTasks, user=Depends(require_perm("approve_expenses"))):
    res = await db.transactions.update_one({"id": tx_id, "status": "onay_bekliyor"},
                                           {"$set": {"status": "onaylandi", "approved_by": user["id"],
                                                     "approved_by_name": user["name"], "approved_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Onay bekleyen işlem bulunamadı")
    t = await db.transactions.find_one({"id": tx_id}, {"_id": 0, "progress_payment_id": 1, "created_by": 1, "amount": 1, "category": 1})
    if t and t.get("progress_payment_id"):
        from routers.progress import close_if_paid
        await close_if_paid(t["progress_payment_id"])
    if t and t.get("created_by") != user["id"]:
        background.add_task(send_push, [t["created_by"]], "Gider onaylandı", f"{tl(t['amount'])} · {t['category']} — {user['name']} onayladı", "/islemler", f"tx-{tx_id}")
    return {"ok": True}


@router.post("/{tx_id}/reject")
async def reject(tx_id: str, data: RejectIn, background: BackgroundTasks, user=Depends(require_perm("approve_expenses"))):
    res = await db.transactions.update_one({"id": tx_id, "status": "onay_bekliyor"},
                                           {"$set": {"status": "reddedildi", "approved_by": user["id"],
                                                     "approved_by_name": user["name"], "approved_at": now_iso(),
                                                     "reject_reason": data.reason}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Onay bekleyen işlem bulunamadı")
    t = await db.transactions.find_one({"id": tx_id}, {"_id": 0, "created_by": 1, "amount": 1, "category": 1, "check_id": 1, "endorsed": 1})
    if t and t.get("endorsed") and t.get("check_id"):
        await _revert_endorsement(t["check_id"])
    if t and t.get("created_by") != user["id"]:
        background.add_task(send_push, [t["created_by"]], "Gider reddedildi", f"{tl(t['amount'])} · {t['category']} — {data.reason or 'gerekçe yok'}", "/islemler", f"tx-{tx_id}")
    return {"ok": True}


@router.delete("/{tx_id}")
async def delete_tx(tx_id: str, user=Depends(get_current_user)):
    t = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="İşlem bulunamadı")
    if t["status"] == "onaylandi" and user["role"] != "yonetici":
        raise HTTPException(status_code=403, detail="Onaylı işlemi sadece yönetici silebilir")
    await db.transactions.delete_one({"id": tx_id})
    if t.get("check_id"):
        if t.get("endorsed"):
            await _revert_endorsement(t["check_id"])
        else:
            await db.checks.delete_one({"id": t["check_id"]})
            await db.reminders.delete_many({"source_id": t["check_id"]})
    return {"ok": True}


async def _revert_endorsement(check_id: str):
    await db.checks.update_one({"id": check_id, "status": "ciro_edildi"}, {"$set": {"status": "portfoyde"},
                               "$unset": {"endorsed_to": "", "endorsed_to_name": "", "endorsed_at": "", "endorse_transaction_id": ""}})
