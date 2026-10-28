from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from core import db, get_current_user, new_id, now_iso, account_balance, require_perm

router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountIn(BaseModel):
    name: str
    type: str  # musteri | taseron
    phone: Optional[str] = ""
    email: Optional[str] = ""
    tax_no: Optional[str] = ""
    address: Optional[str] = ""
    specialty: Optional[str] = ""
    notes: Optional[str] = ""
    site_ids: List[str] = []


@router.get("")
async def list_accounts(type: Optional[str] = None, user=Depends(get_current_user)):
    q = {"type": type} if type else {}
    accounts = await db.accounts.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    sites = {s["id"]: s["name"] async for s in db.sites.find({}, {"_id": 0, "id": 1, "name": 1})}
    for a in accounts:
        a.update(await account_balance(a))
        a["site_names"] = [sites[x] for x in a.get("site_ids", []) if x in sites]
    return accounts


class AssignIn(BaseModel):
    site_id: str


@router.post("/{account_id}/assign-site")
async def assign_site(account_id: str, data: AssignIn, user=Depends(get_current_user)):
    res = await db.accounts.update_one({"id": account_id}, {"$addToSet": {"site_ids": data.site_id}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Cari bulunamadı")
    return {"ok": True}


@router.delete("/{account_id}/assign-site/{site_id}")
async def unassign_site(account_id: str, site_id: str, user=Depends(get_current_user)):
    await db.accounts.update_one({"id": account_id}, {"$pull": {"site_ids": site_id}})
    return {"ok": True}


@router.post("", status_code=201)
async def create_account(data: AccountIn, user=Depends(get_current_user)):
    if data.type not in ("musteri", "taseron"):
        raise HTTPException(status_code=400, detail="Tip musteri veya taseron olmalı")
    doc = {"id": new_id(), **data.model_dump(), "created_at": now_iso(), "created_by": user["id"]}
    await db.accounts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/{account_id}")
async def get_account(account_id: str, user=Depends(get_current_user)):
    acc = await db.accounts.find_one({"id": account_id}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="Cari bulunamadı")
    acc.update(await account_balance(acc))
    sites = {s["id"]: s["name"] async for s in db.sites.find({}, {"_id": 0, "id": 1, "name": 1})}
    acc["site_names"] = [sites[x] for x in acc.get("site_ids", []) if x in sites]
    return acc


@router.put("/{account_id}")
async def update_account(account_id: str, data: AccountIn, user=Depends(require_perm("edit_accounts"))):
    res = await db.accounts.update_one({"id": account_id}, {"$set": data.model_dump()})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Cari bulunamadı")
    return await get_account(account_id, user)


@router.delete("/{account_id}")
async def delete_account(account_id: str, user=Depends(get_current_user)):
    await db.accounts.delete_one({"id": account_id})
    return {"ok": True}


@router.get("/{account_id}/statement")
async def statement(account_id: str, user=Depends(get_current_user)):
    acc = await db.accounts.find_one({"id": account_id}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="Cari bulunamadı")
    is_customer = acc["type"] == "musteri"
    sites = {s["id"]: s["name"] async for s in db.sites.find({}, {"_id": 0, "id": 1, "name": 1})}
    rows = []
    # Müşteri: hakediş = borç (müşteri bize borçlanır), tahsilat = alacak. Taşeron: hakediş = alacak (taşeron alacaklanır), ödeme = avans/borç.
    async for h in db.progress_payments.find({"account_id": account_id, "status": {"$in": ["onaylandi", "odendi"]}}, {"_id": 0}):
        rows.append({"date": h["date"], "type": "hakedis", "description": f"Hakediş No {h['number']} - {sites.get(h.get('site_id'), '')}",
                     "debit": h["net_amount"] if is_customer else 0, "credit": 0 if is_customer else h["net_amount"], "ref_id": h["id"], "sort": 0})
    ttype = "gelir" if is_customer else "gider"
    kasa_names = {"nakit": "Nakit", "cek": "Çek"}
    async for t in db.transactions.find({"account_id": account_id, "status": "onaylandi", "type": ttype}, {"_id": 0}):
        base = "Tahsilat" if is_customer else "Avans ödemesi"
        rows.append({"date": t["date"], "type": "tahsilat" if is_customer else "avans",
                     "description": f"{base} ({kasa_names.get(t.get('kasa'), '')}) - {t.get('description') or t.get('category')}",
                     "debit": 0 if is_customer else t["amount"], "credit": t["amount"] if is_customer else 0, "ref_id": t["id"], "sort": 1})
    rows.sort(key=lambda r: (r["date"] or "", r["sort"]))
    bal = 0
    for r in rows:
        # bakiye: müşteride (+) bizim alacağımız; taşeronda (+) taşerona borcumuz, (−) taşeronun avans borcu
        bal += (r["debit"] - r["credit"]) if is_customer else (r["credit"] - r["debit"])
        r["balance"] = round(bal, 2)
        r.pop("sort", None)
    acc.update(await account_balance(acc))
    return {"account": acc, "rows": rows}
