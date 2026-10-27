from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
from core import db, get_current_user, require_role, new_id, now_iso, r2, OVERHEAD_RATE, require_perm

router = APIRouter(prefix="/progress-payments", tags=["progress"])


class Item(BaseModel):
    description: str
    unit: str = "m²"
    quantity: float = 0
    unit_price: float = 0


class ProgressIn(BaseModel):
    site_id: str
    account_id: str
    type: str  # musteri | taseron
    date: str
    period: Optional[str] = ""
    items: List[Item]
    vat_rate: float = 20
    apply_overhead: bool = True
    previous_deduction: float = 0
    advance_deduction: float = 0
    retention_rate: float = 0
    notes: Optional[str] = ""
    terms: Optional[str] = ""
    technical_spec: Optional[str] = ""


def calc(data: ProgressIn) -> dict:
    items = []
    subtotal = 0.0
    for it in data.items:
        total = it.quantity * it.unit_price
        subtotal += total
        items.append({**it.model_dump(), "total": r2(total)})
    overhead = subtotal * OVERHEAD_RATE if (data.apply_overhead and data.type == "musteri") else 0
    retention = subtotal * data.retention_rate / 100
    base = subtotal - overhead - retention - data.previous_deduction - data.advance_deduction
    vat = base * data.vat_rate / 100
    net = base + vat
    return {"items": items, "subtotal": r2(subtotal), "overhead_rate": OVERHEAD_RATE if (data.apply_overhead and data.type == "musteri") else 0,
            "overhead_amount": r2(overhead), "retention_amount": r2(retention), "base_amount": r2(base),
            "vat_amount": r2(vat), "net_amount": r2(net), "advance_deduction": r2(data.advance_deduction)}


async def outstanding_advance(account_id: str, exclude_pid: Optional[str] = None) -> dict:
    """Açık avans = carinin toplam ödemesi/tahsilatı − diğer onaylı hakedişlerin brüt tutarı (fazla ödenen kısım)."""
    acc = await db.accounts.find_one({"id": account_id}, {"_id": 0, "type": 1})
    if not acc:
        raise HTTPException(status_code=404, detail="Cari bulunamadı")
    ttype = "gelir" if acc["type"] == "musteri" else "gider"
    paid = await db.transactions.aggregate([{"$match": {"account_id": account_id, "status": "onaylandi", "type": ttype}},
                                            {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    q = {"account_id": account_id, "status": {"$in": ["onaylandi", "odendi"]}}
    if exclude_pid: q["id"] = {"$ne": exclude_pid}
    used = await db.progress_payments.aggregate([{"$match": q}, {"$group": {"_id": None, "t": {"$sum": {"$add": ["$net_amount", {"$ifNull": ["$advance_deduction", 0]}]}}}}]).to_list(1)
    total = float(paid[0]["t"]) if paid else 0.0
    applied = float(used[0]["t"]) if used else 0.0
    return {"account_type": acc["type"], "advance_total": r2(total), "applied": r2(applied), "outstanding": r2(max(total - applied, 0))}


@router.get("/advance-balance")
async def advance_balance(account_id: str, exclude_pid: Optional[str] = None, user=Depends(get_current_user)):
    return await outstanding_advance(account_id, exclude_pid)


async def _enrich(h: dict) -> dict:
    s = await db.sites.find_one({"id": h["site_id"]}, {"_id": 0, "name": 1})
    a = await db.accounts.find_one({"id": h["account_id"]}, {"_id": 0, "name": 1})
    h["site_name"] = s["name"] if s else None
    h["account_name"] = a["name"] if a else None
    return h


@router.get("")
async def list_progress(site_id: Optional[str] = None, account_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {}
    if site_id: q["site_id"] = site_id
    if account_id: q["account_id"] = account_id
    rows = await db.progress_payments.find(q, {"_id": 0}).sort([("date", -1), ("number", -1)]).to_list(1000)
    return [await _enrich(h) for h in rows]


@router.post("", status_code=201)
async def create_progress(data: ProgressIn, user=Depends(get_current_user)):
    if data.type not in ("musteri", "taseron"):
        raise HTTPException(status_code=400, detail="Tip musteri veya taseron olmalı")
    count = await db.progress_payments.count_documents({"site_id": data.site_id, "account_id": data.account_id})
    doc = {"id": new_id(), **data.model_dump(exclude={"items"}), **calc(data), "number": count + 1,
           "status": "taslak", "ai_summary": None, "created_at": now_iso(), "created_by": user["id"]}
    await db.progress_payments.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/{pid}")
async def get_progress(pid: str, user=Depends(get_current_user)):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    return await _enrich(h)


@router.put("/{pid}")
async def update_progress(pid: str, data: ProgressIn, user=Depends(require_perm("edit_progress"))):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    if h["status"] == "odendi" and user["role"] != "yonetici":
        raise HTTPException(status_code=400, detail="Ödenmiş hakedişi yalnızca yönetici düzenleyebilir")
    new = {**data.model_dump(exclude={"items"}), **calc(data), "edited_by": user["id"], "edited_by_name": user["name"], "edited_at": now_iso()}
    if user["role"] != "yonetici" and h["status"] == "onaylandi" and abs(float(new.get("net_amount", 0)) - float(h.get("net_amount", 0))) > 0.01:
        new.update({"status": "taslak", "status_changed_at": now_iso(), "reapproval_note": "Tutar değişti — yeniden onay gerekli"})
    await db.progress_payments.update_one({"id": pid}, {"$set": new})
    if h.get("overhead_tx_id") and h["type"] == "musteri":
        amt = r2(float(new.get("subtotal") or 0) * OVERHEAD_RATE)
        await db.transactions.update_one({"id": h["overhead_tx_id"]}, {"$set": {"amount": amt, "date": new.get("date") or h.get("date"), "site_id": new.get("site_id"), "account_id": new.get("account_id")}})
    await close_if_paid(pid)
    return await get_progress(pid, user)


class StatusIn(BaseModel):
    status: str  # taslak | onaylandi | odendi


@router.patch("/{pid}/status")
async def set_status(pid: str, data: StatusIn, user=Depends(require_perm("edit_progress"))):
    if data.status not in ("taslak", "onaylandi", "odendi"):
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    await db.progress_payments.update_one({"id": pid}, {"$set": {"status": data.status, "status_changed_at": now_iso()}})
    from routers.transactions import create_overhead_virman, remove_overhead_virman
    if data.status == "taslak":
        await remove_overhead_virman(h)
    elif h["type"] == "musteri":
        await create_overhead_virman(h, user)
    if data.status == "onaylandi":
        await close_if_paid(pid)
    return {"ok": True}


@router.delete("/{pid}")
async def delete_progress(pid: str, user=Depends(require_role("yonetici"))):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if h:
        from routers.transactions import remove_overhead_virman
        await remove_overhead_virman(h)
    await db.progress_payments.delete_one({"id": pid})
    return {"ok": True}


class PayIn(BaseModel):
    date: str
    nakit_amount: float = 0
    cek_amount: float = 0
    check_due_date: Optional[str] = None
    check_bank: Optional[str] = ""
    check_no: Optional[str] = ""
    description: Optional[str] = ""
    attachment_file_id: Optional[str] = None


@router.get("/{pid}/payments")
async def progress_payments_list(pid: str, user=Depends(get_current_user)):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0, "net_amount": 1})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    rows = await db.transactions.find({"progress_payment_id": pid}, {"_id": 0}).sort("date", 1).to_list(200)
    paid = sum(t["amount"] for t in rows if t["status"] == "onaylandi")
    pending = sum(t["amount"] for t in rows if t["status"] == "onay_bekliyor")
    return {"rows": rows, "paid": r2(paid), "pending": r2(pending), "remaining": r2(h["net_amount"] - paid)}


@router.post("/{pid}/pay", status_code=201)
async def pay_progress(pid: str, data: PayIn, background: BackgroundTasks, user=Depends(get_current_user)):
    from routers.transactions import TransactionIn, create_transaction
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    if h["status"] == "taslak":
        raise HTTPException(status_code=400, detail="Önce hakedişi onaylayın")
    if h.get("type") == "musteri":
        raise HTTPException(status_code=400, detail="Müşteri tahsilatı hakediş üzerinden alınmaz; İşlemler → Tahsilat ile kaydedin. Avans ve tahsilatlar hakedişten otomatik düşülür.")
    if data.nakit_amount <= 0 and data.cek_amount <= 0:
        raise HTTPException(status_code=400, detail="Nakit veya çek tutarı girin")
    if data.cek_amount > 0 and not data.check_due_date:
        raise HTTPException(status_code=400, detail="Çek için vade tarihi girin")
    cat = "Taşeron Hakediş Ödemesi" if h["type"] == "taseron" else "Hakediş Tahsilatı"
    ttype = "gider" if h["type"] == "taseron" else "gelir"
    desc = data.description or f"Hakediş No {h['number']} {'ödemesi' if ttype == 'gider' else 'tahsilatı'}"
    created = []
    for kasa, amount in (("nakit", data.nakit_amount), ("cek", data.cek_amount)):
        if amount <= 0:
            continue
        tx = TransactionIn(site_id=h["site_id"], account_id=h["account_id"], type=ttype, category=cat, amount=amount, date=data.date,
                           description=desc, kasa=kasa, attachment_file_id=data.attachment_file_id,
                           check_due_date=data.check_due_date if kasa == "cek" else None, check_bank=data.check_bank, check_no=data.check_no)
        doc = await create_transaction(tx, background, user)
        await db.transactions.update_one({"id": doc["id"]}, {"$set": {"progress_payment_id": pid}})
        doc["progress_payment_id"] = pid
        created.append(doc)
    await close_if_paid(pid)
    return {"created": created, **(await progress_payments_list(pid, user))}


async def close_if_paid(pid: str):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0, "net_amount": 1, "status": 1})
    if not h or h["status"] not in ("onaylandi", "odendi"):
        return
    agg = await db.transactions.aggregate([{"$match": {"progress_payment_id": pid, "status": "onaylandi"}},
                                           {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    paid = agg[0]["t"] if agg else 0
    if paid >= h["net_amount"] - 0.01 and h["status"] == "onaylandi":
        await db.progress_payments.update_one({"id": pid}, {"$set": {"status": "odendi", "status_changed_at": now_iso()}})
    elif paid < h["net_amount"] - 0.01 and h["status"] == "odendi":
        await db.progress_payments.update_one({"id": pid}, {"$set": {"status": "onaylandi", "status_changed_at": now_iso()}})


@router.get("/{pid}/excel")
async def progress_excel(pid: str, user=Depends(get_current_user)):
    from fastapi.responses import Response
    from excel import build_document, COMPANY

    def COMPANY_UPPER():
        return COMPANY.get('upper', '')
    h = await get_progress(pid, user)
    meta = [("Hakediş No", h["number"]), ("Tarih", h["date"]), ("Dönem", h.get("period") or ""),
            ("Hakediş Tipi", "Müşteri Hakedişi" if h["type"] == "musteri" else "Taşeron Hakedişi"),
            ("Cari Hesap", h.get("account_name") or ""), ("Şantiye", h.get("site_name") or ""),
            ("Durum", {"taslak": "Taslak", "onaylandi": "Onaylandı", "odendi": "Ödendi"}.get(h["status"], h["status"]))]
    totals = [("Ara Toplam", h["subtotal"], False)]
    if h.get("overhead_amount"): totals.append((f"Genel Gider Kesintisi (%{int(h['overhead_rate'] * 100)})", -h["overhead_amount"], False))
    if h.get("retention_amount"): totals.append((f"Teminat (%{h['retention_rate']:g})", -h["retention_amount"], False))
    if h.get("previous_deduction"): totals.append(("Önceki Kesinti", -h["previous_deduction"], False))
    if h.get("advance_deduction"): totals.append(("Avans Mahsubu", -h["advance_deduction"], False))
    totals += [("KDV Matrahı", h["base_amount"], False), (f"KDV %{h['vat_rate']:g}", h["vat_amount"], False), ("NET ÖDENECEK", h["net_amount"], True)]
    sections = [("ŞARTLAR", h.get("terms")), ("TEKNİK ŞARTNAME", h.get("technical_spec")), ("NOTLAR", h.get("notes")), ("YAPAY ZEKA ÖZETİ", h.get("ai_summary"))]
    from excel import refresh_company
    await refresh_company()
    data = build_document("HAKEDİŞ", meta, h["items"], totals, sections, ("Hazırlayan / Kontrol Eden", f"ONAYLAYAN\n{COMPANY_UPPER()}\nKaşe / İmza"))
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"hakedis-{h['number']}.xlsx\""})
