import os
import re
import json
import logging
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import Optional
from emergentintegrations.llm.chat import UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
from core import db, get_current_user
from routers.ai import _chat
from routers.transactions import EXPENSE_CATEGORIES, INCOME_CATEGORIES, SUB_CATEGORIES

router = APIRouter(prefix="/voice", tags=["voice"])
logger = logging.getLogger("devrantas.voice")
EXT = {"audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/ogg": "ogg", "video/mp4": "mp4"}
TR_NUM = {"bir": 1, "iki": 2, "üç": 3, "dört": 4, "beş": 5, "altı": 6, "yedi": 7, "sekiz": 8, "dokuz": 9, "on": 10, "yirmi": 20, "otuz": 30, "kırk": 40,
          "elli": 50, "altmış": 60, "yetmiş": 70, "seksen": 80, "doksan": 90, "yüz": 100, "bin": 1000, "milyon": 1_000_000}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().replace("i̇", "i")).strip()


def _words_to_number(text: str) -> Optional[float]:
    m = re.search(r"(\d[\d\.\,]*)\s*(bin|milyon)?", text)
    if m:
        n = float(m.group(1).replace(".", "").replace(",", "."))
        return n * (1000 if m.group(2) == "bin" else 1_000_000 if m.group(2) == "milyon" else 1)
    total, cur = 0, 0
    found = False
    for w in text.split():
        if w not in TR_NUM:
            continue
        found = True
        v = TR_NUM[w]
        if v == 100:
            cur = (cur or 1) * 100
        elif v >= 1000:
            total += (cur or 1) * v
            cur = 0
        else:
            cur += v
    return float(total + cur) if found else None


def _match(name_list: list, text: str) -> Optional[dict]:
    t = _norm(text)
    best, score = None, 0
    for item in name_list:
        words = [w for w in re.split(r"[\s\-/]+", _norm(item["name"])) if len(w) > 2]
        hit = sum(1 for w in words if w[:5] in t)
        if hit > score:
            best, score = item, hit
    return best if score else None


def _fallback(text: str, sites: list, accounts: list) -> dict:
    t = _norm(text)
    is_income = any(k in t for k in ("tahsilat", "tahsil et", "para aldı", "müşteriden aldı", "ödeme aldı", "gelir"))
    cats = INCOME_CATEGORIES if is_income else EXPENSE_CATEGORIES
    kw = {"Malzeme": ["çimento", "demir", "kum", "alçı", "boya", "malzeme", "tuğla", "sıva", "seramik", "eps", "mantolama", "alçıpan", "kireç", "çakıl", "kablo", "nalbur"],
          "Nakliye": ["nakliye", "kamyon", "taşıma", "sevkiyat"], "Yakıt": ["mazot", "benzin", "yakıt", "akaryakıt"], "İşçilik": ["işçi", "yevmiye", "usta", "işçilik"],
          "Taşeron Avansı": ["avans"], "Taşeron Hakediş Ödemesi": ["hakediş", "taşeron"], "Makine/Ekipman": ["makine", "ekipman", "kiralama", "vinç", "mikser", "jeneratör"],
          "Kira": ["kira"], "Vergi/Harç": ["vergi", "harç", "ssk", "sgk"], "Tedarikçi": ["tedarikçi", "fatura"]}
    cat = "Diğer" if not is_income else "Hakediş Tahsilatı"
    if not is_income:
        for c, ks in kw.items():
            if any(k in t for k in ks):
                cat = c
                break
    site = _match(sites, t)
    acc = _match([a for a in accounts if a["type"] == ("musteri" if is_income else "taseron")], t) if (is_income or cat in SUB_CATEGORIES) else _match(accounts, t)
    kasa = "cek" if "çek" in t else "nakit"
    return {"type": "gelir" if is_income else "gider", "category": cat if cat in cats else cats[-1], "amount": _words_to_number(t), "site_id": site["id"] if site else None,
            "account_id": acc["id"] if acc else None, "kasa": kasa, "description": text.strip()}


async def parse_expense(text: str) -> dict:
    sites = await db.sites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(300)
    accounts = await db.accounts.find({}, {"_id": 0, "id": 1, "name": 1, "type": 1}).to_list(1000)
    fb = _fallback(text, sites, accounts)
    prompt = (
        "Aşağıdaki Türkçe konuşma metnini bir şantiye gider/tahsilat kaydına dönüştür ve SADECE JSON döndür.\n"
        f"Metin: \"{text}\"\n\n"
        f"Şantiyeler (id | ad):\n" + "\n".join(f"{s['id']} | {s['name']}" for s in sites) + "\n\n"
        "Cariler (id | ad | tür):\n" + "\n".join(f"{a['id']} | {a['name']} | {a['type']}" for a in accounts) + "\n\n"
        f"Gider kategorileri: {', '.join(EXPENSE_CATEGORIES)}\nGelir kategorileri: {', '.join(INCOME_CATEGORIES)}\n"
        "Kurallar: Para tutarını sayı olarak ver (\"beş yüz lira\"=500, \"iki bin beş yüz\"=2500, \"1.250\"=1250). Varsayılan tip 'gider'. "
        "'çimento aldım', 'malzeme aldık', 'ödedim' gibi satın alma ifadeleri GİDERDİR. Yalnızca 'tahsilat', 'tahsil ettim', 'müşteriden para aldım', 'ödeme aldım' gibi para GİRİŞİ anlatılıyorsa 'gelir'. "
        "Çimento, demir, kum, boya, alçı vb. → 'Malzeme'; mazot/benzin → 'Yakıt'; kamyon/nakliye → 'Nakliye'; avans → 'Taşeron Avansı'; hakediş ödemesi → 'Taşeron Hakediş Ödemesi'. "
        "Şantiye adı metinde kısmen geçiyorsa (örn. 'Çekmeköy') eşleştir, emin değilsen null. Cari adı geçiyorsa eşleştir yoksa null. "
        "'çek' veya 'çekle' geçiyorsa kasa='cek', aksi halde 'nakit'. description: kısa, düzgün Türkçe açıklama (ör. 'Çimento alımı'). "
        "JSON şeması: {\"type\":\"gider|gelir\",\"category\":str,\"amount\":number|null,\"site_id\":str|null,\"account_id\":str|null,\"kasa\":\"nakit|cek\",\"description\":str}"
    )
    try:
        llm = _chat("voice-parse", "Sen bir veri çıkarma asistanısın. Yalnızca geçerli JSON döndür, açıklama ekleme.")
        resp = await llm.send_message(UserMessage(text=prompt))
        raw = resp if isinstance(resp, str) else str(resp)
        m = re.search(r"\{.*\}", raw, re.S)
        data = json.loads(m.group(0)) if m else {}
        site_ids = {s["id"] for s in sites}
        acc_ids = {a["id"] for a in accounts}
        out = {**fb}
        if data.get("type") in ("gider", "gelir"): out["type"] = data["type"]
        cats = INCOME_CATEGORIES if out["type"] == "gelir" else EXPENSE_CATEGORIES
        if data.get("category") in cats: out["category"] = data["category"]
        elif out["category"] not in cats: out["category"] = cats[-1]
        if isinstance(data.get("amount"), (int, float)) and data["amount"] > 0: out["amount"] = float(data["amount"])
        if data.get("site_id") in site_ids: out["site_id"] = data["site_id"]
        if data.get("account_id") in acc_ids: out["account_id"] = data["account_id"]
        if data.get("kasa") in ("nakit", "cek"): out["kasa"] = data["kasa"]
        if data.get("description"): out["description"] = str(data["description"])[:200]
        out["source"] = "ai"
        return out
    except Exception as e:
        logger.error(f"Voice parse LLM failed, fallback used: {e}")
        return {**fb, "source": "fallback"}


@router.post("/expense")
async def voice_expense(audio: Optional[UploadFile] = File(None), text: Optional[str] = Form(None), user=Depends(get_current_user)):
    transcript = (text or "").strip()
    if audio is not None:
        data = await audio.read()
        if len(data) < 500:
            raise HTTPException(status_code=400, detail="Ses kaydı çok kısa, tekrar deneyin")
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Ses kaydı çok büyük")
        ctype = (audio.content_type or "").split(";")[0]
        ext = EXT.get(ctype) or (audio.filename.rsplit(".", 1)[-1] if audio.filename and "." in audio.filename else "webm")
        buf = BytesIO(data)
        buf.name = f"kayit.{ext}"
        try:
            stt = OpenAISpeechToText(api_key=os.environ["EMERGENT_LLM_KEY"])
            res = await stt.transcribe(file=buf, model="whisper-1", language="tr", response_format="json",
                                       prompt="Şantiye gider kaydı: tutar, malzeme, şantiye adı. Örnek: beş yüz lira çimento Çekmeköy.")
            transcript = (res.text if hasattr(res, "text") else str(res)).strip()
        except Exception as e:
            logger.error(f"STT failed: {e}")
            raise HTTPException(status_code=502, detail="Ses yazıya çevrilemedi, tekrar deneyin")
    if not transcript:
        raise HTTPException(status_code=400, detail="Konuşma algılanamadı")
    parsed = await parse_expense(transcript)
    return {"transcript": transcript, **parsed}
