import re
import json
import base64
from io import BytesIO
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from emergentintegrations.llm.chat import UserMessage, ImageContent
from core import db, get_current_user, logger, today_str
from routers.ai import _chat
from routers.whatsapp import best_match, parse_amount, parse_date, norm

router = APIRouter(prefix="/receipt", tags=["receipt"])

PROMPT = (
    "Bu bir Türk bankası dekontu / EFT-havale makbuzu / ödeme fişi fotoğrafıdır. İçindeki bilgileri çıkar ve SADECE JSON döndür.\n"
    "Alanlar: amount (sayı, TL; '50.000,00' → 50000), date (YYYY-MM-DD; işlem tarihi), payer (gönderen ad), payee (alıcı ad), bank (banka adı), "
    "description (açıklama satırı), reference (dekont/ref no), confidence (0-1). Okunamayan alan null olsun. "
    "JSON şeması: {\"amount\":number|null,\"date\":str|null,\"payer\":str|null,\"payee\":str|null,\"bank\":str|null,\"description\":str|null,\"reference\":str|null,\"confidence\":number}"
)


async def _resolve(parsed: dict) -> dict:
    accounts = await db.accounts.find({"is_active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "type": 1}).to_list(1000)
    s = await db.settings.find_one({"id": "company"}, {"_id": 0, "company_name": 1}) or {}
    own = norm(s.get("company_name") or "devrantas")
    out = {**parsed, "account_id": None, "account_name": None, "account_type": None, "type": "gider", "warnings": []}
    for key in ("payee", "payer"):
        val = parsed.get(key) or ""
        if not val or own.split()[0] in norm(val):
            continue  # kendi firmamız; karşı tarafa bak
        a, score = best_match(val, accounts)
        if a:
            out.update({"account_id": a["id"], "account_name": a["name"], "account_type": a["type"], "matched_on": key})
            out["type"] = "gelir" if a["type"] == "musteri" else "gider"
            out["category"] = "Hakediş Tahsilatı" if a["type"] == "musteri" else "Taşeron Avansı"
            break
    if not out.get("account_id"):
        out["warnings"].append("Dekonttaki isim carilerle eşleşmedi; cariyi elle seçin")
        out["category"] = "Diğer"
    if out.get("amount") is None:
        out["warnings"].append("Tutar okunamadı")
    if not out.get("date"):
        out["date"] = today_str(); out["warnings"].append("Tarih okunamadı, bugün yazıldı")
    out["kasa"] = "nakit"
    return out


@router.post("/parse")
async def parse_receipt(file: UploadFile = File(...), user=Depends(get_current_user)):
    raw = await file.read()
    if not raw or len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya boş ya da 12 MB'den büyük")
    mime = (file.content_type or "").lower()
    try:
        from PIL import Image
        im = Image.open(BytesIO(raw))
        if getattr(im, "n_frames", 1) > 1: im.seek(0)
        im = im.convert("RGB")
        im.thumbnail((1600, 1600))
        buf = BytesIO(); im.save(buf, format="JPEG", quality=85)
        raw, mime = buf.getvalue(), "image/jpeg"
    except Exception:
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            raise HTTPException(status_code=400, detail="JPEG/PNG/WEBP fotoğraf yükleyin")
    b64 = base64.b64encode(raw).decode()
    parsed = {}
    try:
        llm = _chat(f"receipt-{user['id']}", "Sen bir dekont okuma asistanısın. Yalnızca geçerli JSON döndür, açıklama ekleme.")
        resp = await llm.send_message(UserMessage(text=PROMPT, file_contents=[ImageContent(image_base64=b64)]))
        txt = resp if isinstance(resp, str) else str(resp)
        m = re.search(r"\{.*\}", txt, re.S)
        parsed = json.loads(m.group(0)) if m else {}
    except Exception as e:
        logger.warning(f"receipt LLM failed: {e}")
        raise HTTPException(status_code=502, detail=f"Dekont okunamadı: {e}")
    if isinstance(parsed.get("amount"), str):
        parsed["amount"] = parse_amount(parsed["amount"])
    if parsed.get("date") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(parsed["date"])):
        parsed["date"] = parse_date(str(parsed["date"]))
    return await _resolve(parsed)
