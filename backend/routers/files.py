import uuid
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Response
from core import db, get_current_user, new_id, now_iso, put_object, get_object, APP_NAME, logger

router = APIRouter(prefix="/files", tags=["files"])
ALLOWED = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
MAX_SIZE = 10 * 1024 * 1024


@router.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    ctype = file.content_type or "application/octet-stream"
    if ctype not in ALLOWED:
        raise HTTPException(status_code=400, detail="Sadece JPG, PNG, WEBP, GIF veya PDF yüklenebilir")
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Dosya 10MB'dan büyük olamaz")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, ctype)
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=502, detail="Dosya depolama servisine yüklenemedi")
    doc = {"id": new_id(), "storage_path": result["path"], "original_filename": file.filename, "content_type": ctype,
           "size": result.get("size", len(data)), "uploaded_by": user["id"], "is_deleted": False, "created_at": now_iso()}
    await db.files.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/{file_id}")
async def download(file_id: str, user=Depends(get_current_user)):
    rec = await db.files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    try:
        data, ctype = get_object(rec["storage_path"])
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=502, detail="Dosya alınamadı")
    from urllib.parse import quote
    name = rec.get("original_filename") or "dosya"
    return Response(content=data, media_type=rec.get("content_type") or ctype,
                    headers={"Content-Disposition": f"inline; filename=\"{name.encode('ascii', 'ignore').decode() or 'dosya'}\"; filename*=UTF-8''{quote(name)}"})
