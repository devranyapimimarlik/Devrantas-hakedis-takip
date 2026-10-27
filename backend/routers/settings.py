import os
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
from core import db, require_role, now_iso, get_object, logger, get_current_user

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


def _parse_repo(raw: str) -> str:
    s = (raw or "").strip()
    s = re.sub(r"^(https?://)?(www\.)?github\.com/", "", s, flags=re.I)
    s = re.sub(r"\.git$", "", s.strip("/"))
    parts = [p for p in s.split("/") if p]
    return "/".join(parts[:2]) if len(parts) >= 2 else s


@router.put("/distribution")
async def update_distribution(data: DistributionIn, user=Depends(require_role("yonetici"))):
    repo = _parse_repo(data.github_repo)
    if repo and not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise HTTPException(status_code=400, detail="GitHub deposu bulunamadı. Depo sayfasının adresini olduğu gibi yapıştırın (ör. https://github.com/kullanici/depo)")
    tf = (data.testflight_url or "").strip()
    if tf and not tf.startswith("https://"):
        raise HTTPException(status_code=400, detail="TestFlight bağlantısı https:// ile başlamalı")
    await db.settings.update_one({"id": "company"}, {"$set": {"github_repo": repo, "testflight_url": tf, "updated_at": now_iso(), "updated_by": user["id"]}}, upsert=True)
    _cache.update({"settings": None})
    return await read_settings()


@router.get("/distribution/status")
async def distribution_status(user=Depends(get_current_user)):
    s = await read_settings()
    repo = s.get("github_repo") or ""
    out = {"repo": repo, "repo_ok": False, "private": None, "workflow_ok": False, "runs": [], "release_ok": False, "assets": [], "error": None, "steps": []}
    if not repo:
        out["steps"].append("Önce 'Save to GitHub' yapıp depo adresini yukarıya kaydedin.")
        return out
    import httpx
    hdr = {"Accept": "application/vnd.github+json", "User-Agent": "devrantas-app"}
    try:
        async with httpx.AsyncClient(timeout=10, headers=hdr, follow_redirects=True) as c:
            r = await c.get(f"https://api.github.com/repos/{repo}")
            if r.status_code == 404:
                out["error"] = "Depo bulunamadı ya da özel (private). Adı kontrol edin; özel depoysa derleme durumu buradan okunamaz ama GitHub Actions yine çalışır."
                out["steps"].append("GitHub'da depo adresini açın; adres çubuğundaki 'github.com/…/…' kısmını buraya yapıştırın.")
                return out
            if r.status_code == 403 or r.status_code == 429:
                out["error"] = "GitHub istek sınırı aşıldı; birkaç dakika sonra 'Yenile' deyin."
                return out
            if r.status_code == 200:
                out["repo_ok"] = True; out["private"] = r.json().get("private")
            w = await c.get(f"https://api.github.com/repos/{repo}/contents/.github/workflows/build-apps.yml")
            out["workflow_ok"] = w.status_code == 200
            if not out["workflow_ok"]:
                out["steps"].append("Depoda .github/workflows/build-apps.yml yok → sohbette 'Save to GitHub' ile son kodu tekrar gönderin.")
            runs = await c.get(f"https://api.github.com/repos/{repo}/actions/runs?per_page=5")
            if runs.status_code == 200:
                out["runs"] = [{"id": x["id"], "name": x.get("name"), "status": x.get("status"), "conclusion": x.get("conclusion"), "url": x.get("html_url"), "created_at": x.get("created_at")} for x in runs.json().get("workflow_runs", [])]
                if not out["runs"]:
                    out["steps"].append("Hiç derleme çalışmamış → GitHub → Actions sekmesi → 'I understand my workflows, go ahead and enable them' → 'Uygulama Derlemeleri' → 'Run workflow'.")
                elif out["runs"][0].get("conclusion") == "failure":
                    out["steps"].append("Son derleme hata verdi → Actions'taki kırmızı çalışmayı açıp hata metnini sohbete yapıştırın.")
            rel = await c.get(f"https://api.github.com/repos/{repo}/releases/latest")
            if rel.status_code == 200:
                out["release_ok"] = True
                out["assets"] = [{"name": a["name"], "url": a["browser_download_url"], "size": a.get("size")} for a in rel.json().get("assets", [])]
                if not any(a["name"].endswith(".exe") for a in out["assets"]): out["steps"].append("Windows .exe henüz yüklenmedi (derleme sürüyor olabilir).")
                if not any(a["name"].endswith(".apk") for a in out["assets"]): out["steps"].append("Android APK henüz yüklenmedi.")
            elif out["runs"] and out["runs"][0].get("status") != "completed":
                out["steps"].append("Derleme çalışıyor; ~10 dk sonra bu sayfayı yenileyin.")
    except Exception as e:
        out["error"] = f"GitHub'a ulaşılamadı: {e}"
    if out["repo_ok"] and out["workflow_ok"] and out["release_ok"] and not out["steps"]:
        out["steps"].append("Her şey hazır: indir düğmeleri çalışıyor.")
    return out


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
            "share_target": {"action": "/islemler", "method": "GET", "params": {"title": "title", "text": "text", "url": "url"}},
            "shortcuts": [{"name": "Gelir-Gider", "url": "/islemler", "icons": icons[:1]}, {"name": "Hakedişler", "url": "/hakedis", "icons": icons[:1]}, {"name": "Çekler", "url": "/cekler", "icons": icons[:1]}]}
    return JSONResponse(data, media_type="application/manifest+json")
