from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import Response
from core import db, require_role, put_object, get_object, now_iso

router = APIRouter(prefix="/downloads", tags=["downloads"])
ALLOWED = {"Devrantas-Setup.exe": "application/vnd.microsoft.portable-executable", "Devrantas.apk": "application/vnd.android.package-archive"}


@router.get("")
async def list_downloads():
    rows = await db.downloads.find({}, {"_id": 0}).to_list(20)
    return {r["name"]: {"size": r.get("size"), "updated_at": r.get("updated_at"), "url": f"/api/downloads/{r['name']}"} for r in rows}


@router.post("/{name}", status_code=201)
async def upload_download(name: str, file: UploadFile = File(...), user=Depends(require_role("yonetici"))):
    if name not in ALLOWED:
        raise HTTPException(status_code=400, detail="Yalnızca Devrantas-Setup.exe veya Devrantas.apk")
    data = await file.read()
    if len(data) < 1000:
        raise HTTPException(status_code=400, detail="Dosya boş")
    put_object(f"downloads/{name}", data, ALLOWED[name])
    await db.downloads.update_one({"name": name}, {"$set": {"name": name, "size": len(data), "updated_at": now_iso(), "uploaded_by": user["id"]}}, upsert=True)
    return {"ok": True, "name": name, "size": len(data)}


@router.get("/{name}")
async def get_download(name: str):
    if name not in ALLOWED:
        raise HTTPException(status_code=404, detail="Dosya yok")
    row = await db.downloads.find_one({"name": name}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Bu dosya henüz yüklenmedi")
    try:
        content, _ = get_object(f"downloads/{name}")
    except Exception:
        raise HTTPException(status_code=502, detail="Dosya deposuna ulaşılamadı")
    return Response(content=content, media_type=ALLOWED[name],
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Content-Length": str(len(content)), "Cache-Control": "public, max-age=3600"})
