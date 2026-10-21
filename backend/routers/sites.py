from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from core import db, get_current_user, new_id, now_iso, site_summary, OVERHEAD_RATE

router = APIRouter(prefix="/sites", tags=["sites"])


class SiteIn(BaseModel):
    name: str
    customer_id: Optional[str] = None
    location: Optional[str] = ""
    contract_amount: float = 0
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str = "devam"  # planlama | devam | tamamlandi | durduruldu
    progress_percent: float = 0
    description: Optional[str] = ""


async def _enrich(site: dict) -> dict:
    site["summary"] = await site_summary(site)
    if site.get("customer_id"):
        c = await db.accounts.find_one({"id": site["customer_id"]}, {"_id": 0, "name": 1})
        site["customer_name"] = c["name"] if c else None
    return site


@router.get("")
async def list_sites(user=Depends(get_current_user)):
    sites = await db.sites.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _enrich(s) for s in sites]


@router.post("", status_code=201)
async def create_site(data: SiteIn, user=Depends(get_current_user)):
    doc = {"id": new_id(), **data.model_dump(), "overhead_rate": OVERHEAD_RATE,
           "created_at": now_iso(), "created_by": user["id"]}
    await db.sites.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/{site_id}")
async def get_site(site_id: str, user=Depends(get_current_user)):
    site = await db.sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Şantiye bulunamadı")
    return await _enrich(site)


@router.put("/{site_id}")
async def update_site(site_id: str, data: SiteIn, user=Depends(get_current_user)):
    res = await db.sites.update_one({"id": site_id}, {"$set": data.model_dump()})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Şantiye bulunamadı")
    return await get_site(site_id, user)


@router.delete("/{site_id}")
async def delete_site(site_id: str, user=Depends(get_current_user)):
    await db.sites.delete_one({"id": site_id})
    return {"ok": True}
