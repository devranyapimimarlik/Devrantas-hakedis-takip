from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from core import db, get_current_user, new_id, now_iso, r2, OVERHEAD_RATE

router = APIRouter(prefix="/proposals", tags=["proposals"])


class Item(BaseModel):
    description: str
    unit: str = "m²"
    quantity: float = 0
    unit_price: float = 0


class ProposalIn(BaseModel):
    account_id: Optional[str] = None
    customer_name: Optional[str] = ""
    title: str
    project_type: Optional[str] = ""
    location: Optional[str] = ""
    area_m2: Optional[float] = 0
    date: str
    valid_until: Optional[str] = None
    items: List[Item] = []
    vat_rate: float = 20
    discount: float = 0
    validity_days: int = 15
    intro_text: Optional[str] = "Firmamızdan talep etmiş olduğunuz işlere ait fiyat teklifimiz aşağıda bilgilerinize sunulmuştur."
    notes: Optional[str] = "• Fiyatlarımıza KDV dahil değildir.\n• Ödeme: hakediş usulü, aylık.\n• Malzeme ve işçilik dahildir; aksi belirtilmedikçe iskele hariçtir."
    ai_text: Optional[str] = ""


def calc(data: ProposalIn) -> dict:
    items, subtotal = [], 0.0
    for it in data.items:
        total = it.quantity * it.unit_price
        subtotal += total
        items.append({**it.model_dump(), "total": r2(total)})
    base = subtotal - data.discount
    vat = base * data.vat_rate / 100
    total = base + vat
    overhead = subtotal * OVERHEAD_RATE
    return {"items": items, "subtotal": r2(subtotal), "base_amount": r2(base), "vat_amount": r2(vat),
            "total": r2(total), "overhead_amount": r2(overhead), "estimated_margin": r2(base - overhead)}


async def _enrich(p: dict) -> dict:
    if p.get("account_id"):
        a = await db.accounts.find_one({"id": p["account_id"]}, {"_id": 0, "name": 1})
        if a:
            p["customer_name"] = a["name"]
    return p


@router.get("")
async def list_proposals(user=Depends(get_current_user)):
    rows = await db.proposals.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _enrich(p) for p in rows]


@router.post("", status_code=201)
async def create_proposal(data: ProposalIn, user=Depends(get_current_user)):
    count = await db.proposals.count_documents({})
    doc = {"id": new_id(), **data.model_dump(exclude={"items"}), **calc(data), "number": str(count + 1),
           "status": "taslak", "created_at": now_iso(), "created_by": user["id"]}
    await db.proposals.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/{pid}")
async def get_proposal(pid: str, user=Depends(get_current_user)):
    p = await db.proposals.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı")
    return await _enrich(p)


@router.put("/{pid}")
async def update_proposal(pid: str, data: ProposalIn, user=Depends(get_current_user)):
    res = await db.proposals.update_one({"id": pid}, {"$set": {**data.model_dump(exclude={"items"}), **calc(data)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı")
    return await get_proposal(pid, user)


class StatusIn(BaseModel):
    status: str  # taslak | gonderildi | kabul | red


@router.patch("/{pid}/status")
async def set_status(pid: str, data: StatusIn, user=Depends(get_current_user)):
    if data.status not in ("taslak", "gonderildi", "kabul", "red"):
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    await db.proposals.update_one({"id": pid}, {"$set": {"status": data.status}})
    return {"ok": True}


@router.delete("/{pid}")
async def delete_proposal(pid: str, user=Depends(get_current_user)):
    await db.proposals.delete_one({"id": pid})
    return {"ok": True}


@router.get("/{pid}/excel")
async def proposal_excel(pid: str, user=Depends(get_current_user)):
    from fastapi.responses import Response
    from excel import build_document
    p = await db.proposals.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı")
    p = await _enrich(p)
    data = build_document("FİYAT TEKLİFİ", [("Teklif No", p["number"]), ("Tarih", p["date"]), ("Sayın", p.get("customer_name") or ""), ("Proje / İş", p["title"]),
                                             ("Proje Türü", p.get("project_type") or ""), ("Konum", p.get("location") or ""), ("Geçerlilik", f"{p.get('validity_days', 15)} gün")],
                          p["items"], [("Ara Toplam", p["subtotal"], False)] + ([("İskonto", -p["discount"], False)] if p.get("discount") else []) +
                          [(f"KDV %{p['vat_rate']:g}", p["vat_amount"], False), ("GENEL TOPLAM", p["total"], True)],
                          [("TEKLİF METNİ", p.get("ai_text")), ("ŞARTLAR VE NOTLAR", p.get("notes"))])
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"teklif-{p['number']}.xlsx\""})
