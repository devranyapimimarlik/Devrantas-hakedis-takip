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


class PhotoIn(BaseModel):
    file_id: str
    date: str
    note: Optional[str] = ""
    progress_percent: Optional[float] = None


@router.get("/{site_id}/photos")
async def list_photos(site_id: str, user=Depends(get_current_user)):
    return await db.site_photos.find({"site_id": site_id}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(500)


@router.post("/{site_id}/photos", status_code=201)
async def add_photo(site_id: str, data: PhotoIn, user=Depends(get_current_user)):
    if not await db.sites.find_one({"id": site_id}):
        raise HTTPException(status_code=404, detail="Şantiye bulunamadı")
    doc = {"id": new_id(), "site_id": site_id, **data.model_dump(), "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()}
    await db.site_photos.insert_one(doc)
    doc.pop("_id", None)
    if data.progress_percent is not None:
        await db.sites.update_one({"id": site_id}, {"$set": {"progress_percent": data.progress_percent}})
    return doc


@router.delete("/{site_id}/photos/{photo_id}")
async def delete_photo(site_id: str, photo_id: str, user=Depends(get_current_user)):
    await db.site_photos.delete_one({"id": photo_id, "site_id": site_id})
    return {"ok": True}
