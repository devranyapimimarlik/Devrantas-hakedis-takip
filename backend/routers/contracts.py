from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List
from core import db, get_current_user, require_role, new_id, now_iso, r2
from excel import build_document, COMPANY


def COMPANY_UPPER():
    return COMPANY.get('upper', '')

router = APIRouter(prefix="/contracts", tags=["contracts"])

DEFAULT_TERMS = ("1. İşin kapsamı yukarıdaki birim fiyat cetvelinde belirtilen imalatlardan oluşur.\n"
                 "2. Ödemeler aylık hakediş usulü ile yapılır; her hakedişten %6 genel gider kesintisi uygulanır.\n"
                 "3. Fiyatlara KDV dahil değildir.\n"
                 "4. Malzeme ve işçilik yükleniciye aittir; aksi belirtilmedikçe iskele ve vinç hariçtir.\n"
                 "5. İş süresi sözleşme tarihinden itibaren belirtilen takvim günüdür; mücbir sebepler hariçtir.\n"
                 "6. Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir.")


class Item(BaseModel):
    description: str
    unit: str = "m²"
    quantity: float = 0
    unit_price: float = 0


class ContractIn(BaseModel):
    title: str
    account_id: Optional[str] = None
    party_name: Optional[str] = ""
    party_type: str = "musteri"  # musteri | taseron
    site_id: Optional[str] = None
    date: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_days: Optional[int] = None
    items: List[Item] = []
    vat_rate: float = 20
    advance_amount: float = 0
    retention_rate: float = 0
    terms: Optional[str] = DEFAULT_TERMS
    technical_spec: Optional[str] = ""
    payment_terms: Optional[str] = "Aylık hakediş usulü; hakediş onayını takiben 7 iş günü içinde ödeme."
    notes: Optional[str] = ""


def calc(data: ContractIn) -> dict:
    items, subtotal = [], 0.0
    for it in data.items:
        total = it.quantity * it.unit_price
        subtotal += total
        items.append({**it.model_dump(), "total": r2(total)})
    vat = subtotal * data.vat_rate / 100
    return {"items": items, "subtotal": r2(subtotal), "vat_amount": r2(vat), "total": r2(subtotal + vat)}


async def _enrich(c: dict) -> dict:
    if c.get("account_id"):
        a = await db.accounts.find_one({"id": c["account_id"]}, {"_id": 0, "name": 1})
        if a: c["party_name"] = a["name"]
    if c.get("site_id"):
        s = await db.sites.find_one({"id": c["site_id"]}, {"_id": 0, "name": 1})
        c["site_name"] = s["name"] if s else None
    return c


@router.get("/defaults")
async def defaults(user=Depends(get_current_user)):
    return {"terms": DEFAULT_TERMS}


@router.get("")
async def list_contracts(user=Depends(get_current_user)):
    rows = await db.contracts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _enrich(c) for c in rows]


@router.post("", status_code=201)
async def create_contract(data: ContractIn, user=Depends(get_current_user)):
    count = await db.contracts.count_documents({})
    doc = {"id": new_id(), **data.model_dump(exclude={"items"}), **calc(data), "number": f"SZL-{count + 1:03d}",
           "status": "taslak", "created_at": now_iso(), "created_by": user["id"]}
    await db.contracts.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/{cid}")
async def get_contract(cid: str, user=Depends(get_current_user)):
    c = await db.contracts.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Sözleşme bulunamadı")
    return await _enrich(c)


@router.put("/{cid}")
async def update_contract(cid: str, data: ContractIn, user=Depends(get_current_user)):
    res = await db.contracts.update_one({"id": cid}, {"$set": {**data.model_dump(exclude={"items"}), **calc(data)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Sözleşme bulunamadı")
    return await get_contract(cid, user)


class StatusIn(BaseModel):
    status: str  # taslak | imzalandi | tamamlandi | feshedildi


@router.patch("/{cid}/status")
async def set_status(cid: str, data: StatusIn, user=Depends(get_current_user)):
    if data.status not in ("taslak", "imzalandi", "tamamlandi", "feshedildi"):
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    await db.contracts.update_one({"id": cid}, {"$set": {"status": data.status}})
    return {"ok": True}


@router.delete("/{cid}")
async def delete_contract(cid: str, user=Depends(require_role("yonetici"))):
    await db.contracts.delete_one({"id": cid})
    return {"ok": True}


@router.get("/{cid}/excel")
async def contract_excel(cid: str, user=Depends(get_current_user)):
    from excel import refresh_company
    await refresh_company()
    c = await get_contract(cid, user)
    meta = [("Sözleşme No", c["number"]), ("Tarih", c["date"]), ("Taraf", c.get("party_name") or ""),
            ("Taraf Tipi", "Müşteri (İşveren)" if c["party_type"] == "musteri" else "Taşeron (Yüklenici)"),
            ("Şantiye / Proje", c.get("site_name") or ""), ("İşin Adı", c["title"]),
            ("Başlangıç", c.get("start_date") or ""), ("Bitiş", c.get("end_date") or ""), ("Süre (gün)", c.get("duration_days") or "")]
    totals = [("Ara Toplam", c["subtotal"], False), (f"KDV %{c['vat_rate']:g}", c["vat_amount"], False), ("SÖZLEŞME BEDELİ", c["total"], True)]
    if c.get("advance_amount"): totals.insert(0, ("Avans", c["advance_amount"], False))
    sections = [("ÖDEME ŞARTLARI", c.get("payment_terms")), ("SÖZLEŞME ŞARTLARI", c.get("terms")),
                ("TEKNİK ŞARTNAME", c.get("technical_spec")), ("NOTLAR", c.get("notes"))]
    sig = ("İŞVEREN\nKaşe / İmza", f"YÜKLENİCİ\n{COMPANY_UPPER()}\nKaşe / İmza") if c["party_type"] == "musteri" else ("YÜKLENİCİ (TAŞERON)\nKaşe / İmza", f"İŞVEREN\n{COMPANY_UPPER()}\nKaşe / İmza")
    data = build_document("SÖZLEŞME", meta, c["items"], totals, sections, sig)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"sozlesme-{c['number']}.xlsx\""})
