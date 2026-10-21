from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from core import db, get_current_user, require_role, new_id, now_iso, r2, OVERHEAD_RATE

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
    overhead = subtotal * OVERHEAD_RATE if data.apply_overhead else 0
    retention = subtotal * data.retention_rate / 100
    base = subtotal - overhead - retention - data.previous_deduction
    vat = base * data.vat_rate / 100
    net = base + vat
    return {"items": items, "subtotal": r2(subtotal), "overhead_rate": OVERHEAD_RATE if data.apply_overhead else 0,
            "overhead_amount": r2(overhead), "retention_amount": r2(retention), "base_amount": r2(base),
            "vat_amount": r2(vat), "net_amount": r2(net)}


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
async def update_progress(pid: str, data: ProgressIn, user=Depends(get_current_user)):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    if h["status"] != "taslak":
        raise HTTPException(status_code=400, detail="Sadece taslak hakedişler düzenlenebilir")
    await db.progress_payments.update_one({"id": pid}, {"$set": {**data.model_dump(exclude={"items"}), **calc(data)}})
    return await get_progress(pid, user)


class StatusIn(BaseModel):
    status: str  # taslak | onaylandi | odendi


@router.patch("/{pid}/status")
async def set_status(pid: str, data: StatusIn, user=Depends(require_role("yonetici", "muhasebe"))):
    if data.status not in ("taslak", "onaylandi", "odendi"):
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    res = await db.progress_payments.update_one({"id": pid}, {"$set": {"status": data.status, "status_changed_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    return {"ok": True}


@router.delete("/{pid}")
async def delete_progress(pid: str, user=Depends(require_role("yonetici"))):
    await db.progress_payments.delete_one({"id": pid})
    return {"ok": True}


@router.get("/{pid}/excel")
async def progress_excel(pid: str, user=Depends(get_current_user)):
    from fastapi.responses import Response
    from excel import build_document
    h = await get_progress(pid, user)
    meta = [("Hakediş No", h["number"]), ("Tarih", h["date"]), ("Dönem", h.get("period") or ""),
            ("Hakediş Tipi", "Müşteri Hakedişi" if h["type"] == "musteri" else "Taşeron Hakedişi"),
            ("Cari Hesap", h.get("account_name") or ""), ("Şantiye", h.get("site_name") or ""),
            ("Durum", {"taslak": "Taslak", "onaylandi": "Onaylandı", "odendi": "Ödendi"}.get(h["status"], h["status"]))]
    totals = [("Ara Toplam", h["subtotal"], False)]
    if h.get("overhead_amount"): totals.append((f"Genel Gider Kesintisi (%{int(h['overhead_rate'] * 100)})", -h["overhead_amount"], False))
    if h.get("retention_amount"): totals.append((f"Teminat (%{h['retention_rate']:g})", -h["retention_amount"], False))
    if h.get("previous_deduction"): totals.append(("Önceki Kesinti / Avans", -h["previous_deduction"], False))
    totals += [("KDV Matrahı", h["base_amount"], False), (f"KDV %{h['vat_rate']:g}", h["vat_amount"], False), ("NET ÖDENECEK", h["net_amount"], True)]
    sections = [("ŞARTLAR", h.get("terms")), ("TEKNİK ŞARTNAME", h.get("technical_spec")), ("NOTLAR", h.get("notes")), ("YAPAY ZEKA ÖZETİ", h.get("ai_summary"))]
    data = build_document("HAKEDİŞ", meta, h["items"], totals, sections, ("Hazırlayan / Kontrol Eden", "ONAYLAYAN\nDEVRANTAŞ YAPI MİMARLIK\nKaşe / İmza"))
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"hakedis-{h['number']}.xlsx\""})
