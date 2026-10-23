from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from core import db, get_current_user, require_role, new_id, now_iso
from routers.push import send_push


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
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    sites, accounts = await _lookups()
    enriched = await _enrich(doc, sites, accounts)
    if status == "onay_bekliyor":
        site_name = enriched.get("site_name") or "Genel"
        background.add_task(send_push, None, "Onay bekleyen gider", f"{tl(data.amount)} · {data.category} · {site_name} — {user['name']}", "/islemler?tab=onay", f"tx-{doc['id']}", ["yonetici"])
    return enriched


@router.post("/{tx_id}/approve")
async def approve(tx_id: str, background: BackgroundTasks, user=Depends(require_role("yonetici"))):
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
async def reject(tx_id: str, data: RejectIn, background: BackgroundTasks, user=Depends(require_role("yonetici"))):
    res = await db.transactions.update_one({"id": tx_id, "status": "onay_bekliyor"},
                                           {"$set": {"status": "reddedildi", "approved_by": user["id"],
                                                     "approved_by_name": user["name"], "approved_at": now_iso(),
                                                     "reject_reason": data.reason}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Onay bekleyen işlem bulunamadı")
    t = await db.transactions.find_one({"id": tx_id}, {"_id": 0, "created_by": 1, "amount": 1, "category": 1})
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
        await db.checks.delete_one({"id": t["check_id"]})
        await db.reminders.delete_many({"source_id": t["check_id"]})
    return {"ok": True}
