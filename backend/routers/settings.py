import os
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
from core import db, require_role, now_iso, get_object, logger

router = APIRouter(prefix="/settings", tags=["settings"])
FONT_DIR = Path(__file__).parent.parent / "fonts"
DEFAULTS = {"company_name": "Devrantaş Yapı Mimarlık İnşaat Ltd. Şti.", "short_name": "Devrantaş", "tagline": "Yapı Mimarlık",
            "address": "Nurtanesi Sok. No: 3/1, Merkez Mah., Çekmeköy, İstanbul", "phone": "0533 482 57 02",
            "email": "Devrantasyapimimarlik@gmail.com", "tax_office": "", "tax_no": "", "iban": "",
            "primary_color": "#B8860B", "logo_file_id": None, "github_repo": "", "testflight_url": ""}
_cache = {"settings": None, "logo_path": None, "logo_file_id": None}


class SettingsIn(BaseModel):
    company_name: str
    short_name: str
    tagline: Optional[str] = ""
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    tax_office: Optional[str] = ""
    tax_no: Optional[str] = ""
    iban: Optional[str] = ""
    primary_color: str = "#B8860B"
    logo_file_id: Optional[str] = None
    github_repo: Optional[str] = ""
    testflight_url: Optional[str] = ""


class DistributionIn(BaseModel):
    github_repo: Optional[str] = ""
    testflight_url: Optional[str] = ""


async def get_settings() -> dict:
    if _cache["settings"] is None:
        doc = await db.settings.find_one({"id": "company"}, {"_id": 0}) or {}
        _cache["settings"] = {**DEFAULTS, **doc, "id": "company"}
    return _cache["settings"]


async def company_info() -> dict:
    s = await get_settings()
    return {"name": s["company_name"], "upper": s["company_name"].upper(), "address": s["address"] or "", "phone": f"Tel: {s['phone']}" if s.get("phone") else "",
            "email": f"E-posta: {s['email']}" if s.get("email") else "", "short": s["short_name"], "tagline": s.get("tagline") or ""}


async def logo_path() -> str:
    s = await get_settings()
    fid = s.get("logo_file_id")
    if not fid:
        return str(FONT_DIR / "logo.png")
    if _cache["logo_file_id"] == fid and _cache["logo_path"] and os.path.exists(_cache["logo_path"]):
        return _cache["logo_path"]
    rec = await db.files.find_one({"id": fid, "is_deleted": False}, {"_id": 0})
    if not rec:
        return str(FONT_DIR / "logo.png")
    try:
        data, _ = get_object(rec["storage_path"])
        from PIL import Image
        from io import BytesIO
        im = Image.open(BytesIO(data)).convert("RGBA")
        im.thumbnail((512, 512))
        side = max(im.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        path = str(FONT_DIR / f"logo_{fid}.png")
        canvas.save(path, "PNG")
        _cache.update({"logo_path": path, "logo_file_id": fid})
        return path
    except Exception as e:
        logger.error(f"Logo load failed: {e}")
        return str(FONT_DIR / "logo.png")


@router.get("")
async def read_settings():
    s = await get_settings()
    return {k: v for k, v in s.items() if k != "id"}


@router.put("")
async def update_settings(data: SettingsIn, user=Depends(require_role("yonetici"))):
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", data.primary_color):
        raise HTTPException(status_code=400, detail="Renk #RRGGBB formatında olmalı")
    await db.settings.update_one({"id": "company"}, {"$set": {**data.model_dump(), "updated_at": now_iso(), "updated_by": user["id"]}}, upsert=True)
    _cache.update({"settings": None, "logo_path": None, "logo_file_id": None})
    return await read_settings()


@router.put("/distribution")
async def update_distribution(data: DistributionIn, user=Depends(require_role("yonetici"))):
    repo = (data.github_repo or "").strip().removeprefix("https://github.com/").strip("/")
    if repo and not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise HTTPException(status_code=400, detail="GitHub deposu 'kullanici/depo' biçiminde olmalı")
    tf = (data.testflight_url or "").strip()
    if tf and not tf.startswith("https://"):
        raise HTTPException(status_code=400, detail="TestFlight bağlantısı https:// ile başlamalı")
    await db.settings.update_one({"id": "company"}, {"$set": {"github_repo": repo, "testflight_url": tf, "updated_at": now_iso(), "updated_by": user["id"]}}, upsert=True)
    _cache.update({"settings": None})
    return await read_settings()


@router.get("/logo")
async def logo(v: Optional[str] = None, size: Optional[int] = None):
    path = await logo_path()
    headers = {"Cache-Control": "public, max-age=300"}
    if not size or size not in (180, 192, 512):
        return FileResponse(path, media_type="image/png", headers=headers)
    s = await get_settings()
    out = FONT_DIR / f"icon_{size}_{s.get('logo_file_id') or 'default'}_{s['primary_color'].lstrip('#')}.png"
    if not out.exists():
        from PIL import Image
        im = Image.open(path).convert("RGBA")
        pad = int(size * 0.12)
        im.thumbnail((size - 2 * pad, size - 2 * pad))
        canvas = Image.new("RGB", (size, size), (253, 251, 247))
        canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
        canvas.save(out, "PNG")
    return FileResponse(str(out), media_type="image/png", headers=headers)


@router.get("/manifest.json")
async def manifest():
    s = await get_settings()
    ver = s.get("logo_file_id") or "default"
    icons = [{"src": f"/api/settings/logo?size={sz}&v={ver}", "sizes": f"{sz}x{sz}", "type": "image/png", "purpose": "any maskable"} for sz in (192, 512)]
    data = {"id": "/", "name": f"{s['short_name']} {s.get('tagline') or ''}".strip(), "short_name": s["short_name"], "description": f"{s['company_name']} şantiye finans ve hakediş takibi",
            "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait", "background_color": "#FDFBF7", "theme_color": s["primary_color"], "lang": "tr", "icons": icons,
            "shortcuts": [{"name": "Gelir-Gider", "url": "/islemler", "icons": icons[:1]}, {"name": "Hakedişler", "url": "/hakedis", "icons": icons[:1]}, {"name": "Çekler", "url": "/cekler", "icons": icons[:1]}]}
    return JSONResponse(data, media_type="application/manifest+json")
