from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import re
from core import db, get_current_user, require_role, now_iso, kasa_list, kasa_balances

router = APIRouter(prefix="/kasalar", tags=["kasalar"])


class KasaIn(BaseModel):
    name: str
    kind: str = "banka"  # nakit | cek | banka | fon
    id: Optional[str] = None


def _slug(name: str) -> str:
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = re.sub(r"[^a-z0-9]+", "_", name.translate(tr).lower()).strip("_")
    return s or "kasa"


@router.get("")
async def list_kasalar(user=Depends(get_current_user)):
    bal = await kasa_balances()
    return [{**k, "balance": bal.get(k["id"], {}).get("balance", 0.0)} for k in await kasa_list()]


@router.post("", status_code=201)
async def create_kasa(data: KasaIn, user=Depends(require_role("yonetici"))):
    if data.kind not in ("nakit", "cek", "banka", "fon"):
        raise HTTPException(status_code=400, detail="Tür nakit, cek, banka veya fon olmalı")
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Kasa adı gerekli")
    kid = _slug(data.id or name)
    if await db.kasalar.find_one({"id": kid}):
        raise HTTPException(status_code=400, detail="Bu kasa zaten var")
    count = await db.kasalar.count_documents({})
    doc = {"id": kid, "name": name, "kind": data.kind, "system": False, "order": count, "created_at": now_iso(), "created_by": user["id"]}
    await db.kasalar.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "balance": 0.0}


@router.put("/{kasa_id}")
async def rename_kasa(kasa_id: str, data: KasaIn, user=Depends(require_role("yonetici"))):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Kasa adı gerekli")
    upd = {"name": name, "updated_at": now_iso()}
    if data.kind in ("nakit", "cek", "banka", "fon"):
        upd["kind"] = data.kind
    res = await db.kasalar.update_one({"id": kasa_id}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Kasa bulunamadı")
    return {"ok": True}


@router.delete("/{kasa_id}")
async def delete_kasa(kasa_id: str, user=Depends(require_role("yonetici"))):
    k = await db.kasalar.find_one({"id": kasa_id}, {"_id": 0})
    if not k:
        raise HTTPException(status_code=404, detail="Kasa bulunamadı")
    if k.get("system"):
        raise HTTPException(status_code=400, detail="Sistem kasası silinemez")
    used = await db.transactions.count_documents({"$or": [{"kasa": kasa_id}, {"kasa_from": kasa_id}]})
    if used:
        raise HTTPException(status_code=400, detail=f"Bu kasada {used} hareket var; önce hareketleri başka kasaya düzeltin")
    await db.kasalar.delete_one({"id": kasa_id})
    return {"ok": True}
