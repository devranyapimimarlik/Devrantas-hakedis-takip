import base64
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import httpx
from core import db, require_role, now_iso, put_object, get_object
from routers.settings import _cache as settings_cache

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger("devrantas.migrate")
COLLECTIONS = ["users", "sites", "accounts", "transactions", "checks", "payments", "progress_payments", "proposals", "contracts",
               "site_photos", "files", "reminders", "ai_messages", "ai_sessions", "alert_logs"]
SETTINGS_IDS = ["company"]
MAX_INLINE = 15 * 1024 * 1024


async def build_export(inline_files: bool = True) -> dict:
    out = {"version": 1, "exported_at": now_iso(), "collections": {}, "settings": [], "blobs": {}}
    for c in COLLECTIONS:
        out["collections"][c] = await db[c].find({}, {"_id": 0}).to_list(100000)
    out["settings"] = await db.settings.find({"id": {"$in": SETTINGS_IDS}}, {"_id": 0}).to_list(10)
    if inline_files:
        total = 0
        for f in out["collections"]["files"]:
            if f.get("is_deleted") or total > MAX_INLINE:
                continue
            try:
                data, _ = get_object(f["storage_path"])
                total += len(data)
                out["blobs"][f["storage_path"]] = base64.b64encode(data).decode()
            except Exception as e:
                logger.warning(f"Blob export skipped {f.get('storage_path')}: {e}")
    return out


async def apply_import(payload: dict) -> dict:
    if payload.get("version") != 1 or "collections" not in payload:
        raise HTTPException(status_code=400, detail="Geçersiz yedek dosyası")
    counts = {}
    for c in COLLECTIONS:
        docs = payload["collections"].get(c, [])
        await db[c].delete_many({})
        if docs:
            await db[c].insert_many([dict(d) for d in docs])
        counts[c] = len(docs)
    for s in payload.get("settings", []):
        await db.settings.replace_one({"id": s["id"]}, s, upsert=True)
    settings_cache.update({"settings": None, "logo_path": None, "logo_file_id": None})
    blobs = payload.get("blobs", {})
    restored = 0
    types = {f["storage_path"]: f.get("content_type", "application/octet-stream") for f in payload["collections"].get("files", [])}
    for path, b64 in blobs.items():
        try:
            get_object(path)
            continue
        except Exception:
            pass
        try:
            put_object(path, base64.b64decode(b64), types.get(path, "application/octet-stream"))
            restored += 1
        except Exception as e:
            logger.error(f"Blob restore failed {path}: {e}")
    counts["files_restored"] = restored
    return counts


@router.get("/export")
async def export_all(user=Depends(require_role("yonetici"))):
    data = await build_export()
    body = json.dumps(data, ensure_ascii=False).encode()
    return Response(body, media_type="application/json", headers={"Content-Disposition": f"attachment; filename=devrantas-yedek-{now_iso()[:10]}.json"})


@router.post("/import")
async def import_all(file: UploadFile = File(...), user=Depends(require_role("yonetici"))):
    try:
        payload = json.loads((await file.read()).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Dosya okunamadı; devrantas-yedek-*.json dosyasını seçin")
    counts = await apply_import(payload)
    return {"ok": True, "counts": counts}


class PullIn(BaseModel):
    source_url: str
    email: str
    password: str
    dry_run: Optional[bool] = False


@router.post("/pull")
async def pull_from_source(data: PullIn, user=Depends(require_role("yonetici"))):
    base = data.source_url.strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(f"{base}/api/auth/login", json={"email": data.email, "password": data.password})
            if r.status_code != 200:
                raise HTTPException(status_code=400, detail="Kaynak uygulamaya giriş başarısız (e-posta/şifre hatalı)")
            token = r.json()["access_token"]
            r = await c.get(f"{base}/api/admin/export", headers={"Authorization": f"Bearer {token}"})
            if r.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Kaynaktan veri alınamadı ({r.status_code})")
            payload = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Kaynağa ulaşılamadı: {e}")
    summary = {c: len(payload["collections"].get(c, [])) for c in COLLECTIONS}
    if data.dry_run:
        return {"ok": True, "preview": summary}
    counts = await apply_import(payload)
    return {"ok": True, "counts": counts}


@router.get("/stats")
async def stats(user=Depends(require_role("yonetici"))):
    out = {c: await db[c].count_documents({}) for c in COLLECTIONS if c not in ("ai_messages", "ai_sessions", "alert_logs", "reminders")}
    out["test_records"] = await db.sites.count_documents({"name": {"$regex": "^TEST_"}}) + await db.accounts.count_documents({"name": {"$regex": "^TEST_"}})
    return out
