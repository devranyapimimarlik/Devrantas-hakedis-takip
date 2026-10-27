import os
import re
from difflib import SequenceMatcher
from typing import Optional
from fastapi import APIRouter, Depends, Request, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel
from core import db, get_current_user, kasa_list, today_str, logger, new_id, now_iso

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
EXPENSE_WORDS = {"avans": "Taşeron Avansı", "malzeme": "Malzeme", "nakliye": "Nakliye", "tedarikci": "Tedarikçi", "iscilik": "İşçilik",
                 "makine": "Makine/Ekipman", "ekipman": "Makine/Ekipman", "kira": "Kira", "yakit": "Yakıt", "mazot": "Yakıt", "vergi": "Vergi/Harç",
                 "harc": "Vergi/Harç", "genel gider": "Genel Gider", "diger": "Diğer"}
INCOME_WORDS = {"tahsilat": "Hakediş Tahsilatı", "hakedis": "Hakediş Tahsilatı", "avans": "Avans"}
KEYS = {"kasa": "kasa", "odeme": "odeme", "islem": "odeme", "tur": "odeme", "tarih": "tarih", "tutar": "tutar", "miktar": "tutar",
        "santiye": "santiye", "proje": "santiye", "taseron": "taseron", "musteri": "musteri", "cari": "cari", "aciklama": "aciklama", "not": "aciklama"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").translate(TR).lower()).strip()


def best_match(name: str, rows: list, key="name"):
    n = norm(name)
    if not n:
        return None, 0.0
    best, score = None, 0.0
    for r in rows:
        c = norm(r[key])
        sc = 1.0 if c == n else (0.9 if n in c or c in n else SequenceMatcher(None, n, c).ratio())
        if sc > score:
            best, score = r, sc
    return (best, score) if score >= 0.6 else (None, score)


def parse_amount(s: str) -> Optional[float]:
    m = re.search(r"[\d.,]+", s or "")
    if not m:
        return None
    raw = m.group(0)
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".") if len(raw.split(",")[-1]) <= 2 else raw.replace(",", "")
    elif raw.count(".") > 1 or (raw.count(".") == 1 and len(raw.split(".")[-1]) == 3):
        raw = raw.replace(".", "")
    try:
        v = float(raw)
    except ValueError:
        return None
    if re.search(r"\bbin\b", norm(s)):
        v *= 1000
    return round(v, 2)


def parse_date(s: str) -> Optional[str]:
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", s or "")
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100: y += 2000
    try:
        from datetime import date
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


async def parse_message(text: str) -> dict:
    fields, warnings = {}, []
    for line in (text or "").splitlines():
        m = re.match(r"\s*([^:：]+?)\s*[:：]\s*(.+)$", line)
        if not m:
            continue
        key = KEYS.get(norm(m.group(1)).rstrip(".").strip())
        if key:
            fields[key] = m.group(2).strip()
    out = {"type": "gider", "category": None, "amount": None, "date": None, "kasa": None, "site_id": None, "account_id": None, "description": fields.get("aciklama", "")}
    kl = await kasa_list()
    if fields.get("kasa"):
        k, _ = best_match(fields["kasa"], kl)
        out["kasa"] = k["id"] if k else None
        if not k: warnings.append(f"Kasa bulunamadı: {fields['kasa']}")
    elif kl:
        out["kasa"] = kl[0]["id"]
    out["amount"] = parse_amount(fields.get("tutar", ""))
    if out["amount"] is None: warnings.append("Tutar okunamadı")
    out["date"] = parse_date(fields.get("tarih", "")) or today_str()
    sites = await db.sites.find({}, {"_id": 0, "id": 1, "name": 1, "status": 1}).to_list(500)
    accounts = await db.accounts.find({"is_active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "type": 1}).to_list(1000)
    if fields.get("santiye"):
        s, _ = best_match(fields["santiye"], sites)
        out["site_id"] = s["id"] if s else None
        out["site_name"] = s["name"] if s else None
        if not s: warnings.append(f"Şantiye bulunamadı: {fields['santiye']}")
    acc = None
    for key, typ in (("taseron", "taseron"), ("musteri", "musteri"), ("cari", None)):
        if fields.get(key):
            a, _ = best_match(fields[key], [x for x in accounts if not typ or x["type"] == typ])
            if a:
                acc = a
                break
            warnings.append(f"Cari bulunamadı: {fields[key]}")
    if fields.get("taseron") and fields.get("musteri") and acc and acc["type"] == "musteri":
        warnings.append("Hem taşeron hem müşteri yazılmış; müşteri seçildi")
    if acc:
        out["account_id"], out["account_name"], out["account_type"] = acc["id"], acc["name"], acc["type"]
    odeme = norm(fields.get("odeme", ""))
    if acc and acc["type"] == "musteri":
        out["type"] = "gelir"
        out["category"] = next((v for k, v in INCOME_WORDS.items() if k in odeme), "Hakediş Tahsilatı")
    elif acc and acc["type"] == "taseron":
        out["category"] = "Taşeron Avansı"
    else:
        if "tahsilat" in odeme:
            out["type"] = "gelir"; out["category"] = "Diğer"
        else:
            out["category"] = next((v for k, v in EXPENSE_WORDS.items() if k in odeme), "Diğer")
    out["raw_fields"] = fields
    out["warnings"] = warnings
    return out


@router.get("/template")
async def template(user=Depends(get_current_user)):
    kl = await kasa_list()
    txt = ("Kasa : Devrantaş Nakit\nÖdeme : Avans\nTarih : 26.10.2026\nTutar : 50.000 TL\nŞantiye : Ünalan\nTaşeron : Ferdi Kızıltaş\nAçıklama : Ekim avansı")
    txt_cust = ("Kasa : Devrantaş Çek\nÖdeme : Tahsilat\nTarih : 26.10.2026\nTutar : 120.000 TL\nŞantiye : Ünalan\nMüşteri : Eraslan İnşaat\nAçıklama : 2. hakediş tahsilatı")
    return {"template": txt, "template_customer": txt_cust, "kasalar": [k["name"] for k in kl],
            "odeme_turleri": ["Avans", "Tahsilat", "Malzeme", "Nakliye", "İşçilik", "Makine", "Kira", "Yakıt", "Vergi", "Genel Gider", "Diğer"],
            "webhook_url": "/api/whatsapp/inbound"}


class ParseIn(BaseModel):
    text: str


@router.post("/parse")
async def parse(data: ParseIn, user=Depends(get_current_user)):
    return await parse_message(data.text)


def _twiml(msg: str) -> Response:
    from xml.sax.saxutils import escape
    return Response(content=f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>{escape(msg)}</Message></Response>", media_type="application/xml")


@router.post("/inbound")
async def inbound(request: Request, background: BackgroundTasks):
    form = await request.form()
    body = str(form.get("Body") or "")
    sender = str(form.get("From") or "")
    media = str(form.get("MediaUrl0") or "")
    allowed = {re.sub(r"\D", "", x) for x in os.environ.get("MANAGER_PHONE", "").split(",") if x.strip()}
    digits = re.sub(r"\D", "", sender)
    users = await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "phone": 1}).to_list(50)
    user_doc = next((u for u in users if u.get("phone") and re.sub(r"\D", "", u["phone"])[-10:] == digits[-10:]), None)
    if not user_doc and not (allowed and any(digits.endswith(a[-10:]) for a in allowed)):
        logger.warning(f"WhatsApp inbound reddedildi: {sender}")
        return _twiml("Bu numara Devrantaş uygulamasına tanımlı değil. Yönetici panelinden telefonunuzu ekletin.")
    parsed = await parse_message(body)
    if parsed["amount"] is None:
        return _twiml("Tutar okunamadı. Şablon:\nKasa : Devrantaş Nakit\nÖdeme : Avans\nTarih : 26.10.2026\nTutar : 50.000 TL\nŞantiye : Ünalan\nTaşeron : Ferdi Kızıltaş")
    doc = {"id": new_id(), "type": parsed["type"], "category": parsed["category"], "amount": parsed["amount"], "date": parsed["date"],
           "description": parsed.get("description") or f"WhatsApp: {parsed['raw_fields'].get('odeme', '')}".strip(), "kasa": parsed["kasa"] or "nakit",
           "site_id": parsed.get("site_id"), "account_id": parsed.get("account_id"), "status": "onay_bekliyor", "source": "whatsapp",
           "source_phone": sender, "source_media": media or None, "source_text": body, "created_by": (user_doc or {}).get("id") or "whatsapp",
           "created_by_name": f"WhatsApp · {(user_doc or {}).get('name') or sender}", "created_at": now_iso(), "approved_by": None, "approved_at": None,
           "reject_reason": None, "check_id": None, "attachment_file_id": None, "client_key": None}
    await db.transactions.insert_one(doc)
    from routers.push import send_push
    background.add_task(send_push, None, "WhatsApp'tan kayıt geldi", f"{parsed['amount']:,.0f} ₺ · {parsed['category']} · {parsed.get('site_name') or 'Genel'}", "/islemler?tab=bekleyen", f"tx-{doc['id']}", ["yonetici"])
    w = ("\nUyarı: " + "; ".join(parsed["warnings"])) if parsed["warnings"] else ""
    return _twiml(f"Kaydedildi, onay bekliyor.\n{parsed['type'].upper()} {parsed['amount']:,.2f} ₺ · {parsed['category']}\nŞantiye: {parsed.get('site_name') or '-'} · Cari: {parsed.get('account_name') or '-'}{w}\nUygulamada İşlemler → Onay Bekleyen'den onaylayın.")
