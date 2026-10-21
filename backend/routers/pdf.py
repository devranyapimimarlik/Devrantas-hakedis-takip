from io import BytesIO
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from core import db, get_current_user

router = APIRouter(prefix="/pdf", tags=["pdf"])

FONT_DIR = Path(__file__).parent.parent / "fonts"
pdfmetrics.registerFont(TTFont("DejaVu", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))

GOLD = colors.HexColor("#B8860B")
CREAM = colors.HexColor("#FAF5E8")
CHAR = colors.HexColor("#1C1917")
MUTED = colors.HexColor("#57534E")

S_TITLE = ParagraphStyle("t", fontName="DejaVu-Bold", fontSize=16, textColor=GOLD, leading=20)
S_SUB = ParagraphStyle("s", fontName="DejaVu", fontSize=9, textColor=MUTED, leading=12)
S_H = ParagraphStyle("h", fontName="DejaVu-Bold", fontSize=13, textColor=CHAR, leading=16, spaceBefore=6)
S_BODY = ParagraphStyle("b", fontName="DejaVu", fontSize=9.5, textColor=CHAR, leading=14)
S_LABEL = ParagraphStyle("l", fontName="DejaVu-Bold", fontSize=9, textColor=GOLD, leading=12)
S_CELL = ParagraphStyle("c", fontName="DejaVu", fontSize=8.5, textColor=CHAR, leading=11)
S_CELL_B = ParagraphStyle("cb", fontName="DejaVu-Bold", fontSize=8.5, textColor=CHAR, leading=11)


def tl(v) -> str:
    return f"{float(v or 0):,.2f} ₺".replace(",", "X").replace(".", ",").replace("X", ".")


COMPANY = {"name": "Devrantaş Yapı Mimarlık İnşaat Ltd. Şti.", "address": "Nurtanesi Sok. No: 3/1, Merkez Mah., Çekmeköy, İstanbul",
           "phone": "Tel: 0533 482 57 02", "email": "E-posta: Devrantasyapimimarlik@gmail.com"}


def header(story, doc_type: str, number: str, date: str, company: str = "DEVRANTAŞ YAPI MİMARLIK"):
    logo = Image(str(FONT_DIR / "logo.png"), width=18 * mm, height=18 * mm)
    t = Table([[logo, Paragraph(company, S_TITLE), Paragraph(f"<b>{doc_type}</b><br/>No: {number}<br/>Tarih: {date}", S_SUB)]],
              colWidths=[22 * mm, 88 * mm, 60 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (2, 0), (2, 0), "RIGHT"),
                           ("LINEBELOW", (0, 0), (-1, 0), 1.2, GOLD), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (0, 0), 0)]))
    story += [t, Spacer(1, 6 * mm)]


def info_table(story, rows):
    data = [[Paragraph(k, S_LABEL), Paragraph(str(v or "-"), S_BODY)] for k, v in rows]
    t = Table(data, colWidths=[45 * mm, 125 * mm])
    t.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3)]))
    story += [t, Spacer(1, 5 * mm)]


def items_table(story, items):
    data = [[Paragraph(h, S_CELL_B) for h in ["#", "Açıklama", "Birim", "Miktar", "Birim Fiyat", "Toplam"]]]
    for i, it in enumerate(items, 1):
        data.append([Paragraph(str(i), S_CELL), Paragraph(it["description"], S_CELL), Paragraph(it["unit"], S_CELL),
                     Paragraph(f"{it['quantity']:g}", S_CELL), Paragraph(tl(it["unit_price"]), S_CELL), Paragraph(tl(it["total"]), S_CELL)])
    t = Table(data, colWidths=[8 * mm, 72 * mm, 18 * mm, 22 * mm, 25 * mm, 25 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), CREAM), ("LINEBELOW", (0, 0), (-1, 0), 0.8, GOLD),
                           ("GRID", (0, 1), (-1, -1), 0.3, colors.HexColor("#E7E5E4")), ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [t, Spacer(1, 4 * mm)]


def totals_table(story, rows):
    data = [[Paragraph(k, S_CELL_B if bold else S_CELL), Paragraph(v, S_CELL_B if bold else S_CELL)] for k, v, bold in rows]
    t = Table(data, colWidths=[60 * mm, 40 * mm], hAlign="RIGHT")
    style = [("ALIGN", (1, 0), (1, -1), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    style.append(("LINEABOVE", (0, -1), (-1, -1), 1, GOLD))
    style.append(("BACKGROUND", (0, -1), (-1, -1), CREAM))
    t.setStyle(TableStyle(style))
    story += [t, Spacer(1, 6 * mm)]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu-Bold", 8)
    canvas.drawCentredString(105 * mm, 17 * mm, COMPANY["name"])
    canvas.setFont("DejaVu", 7.5)
    canvas.drawCentredString(105 * mm, 13 * mm, COMPANY["address"])
    canvas.drawCentredString(105 * mm, 9.5 * mm, f"{COMPANY['phone']}  •  {COMPANY['email']}")
    canvas.drawRightString(190 * mm, 9.5 * mm, f"Sayfa {doc.page}")
    canvas.setStrokeColor(GOLD)
    canvas.line(20 * mm, 21 * mm, 190 * mm, 21 * mm)
    canvas.restoreState()


def build(story) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=26 * mm)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def pdf_response(data: bytes, filename: str):
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=\"{filename}\""})


@router.get("/progress-payment/{pid}")
async def progress_pdf(pid: str, user=Depends(get_current_user)):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    site = await db.sites.find_one({"id": h["site_id"]}, {"_id": 0}) or {}
    acc = await db.accounts.find_one({"id": h["account_id"]}, {"_id": 0}) or {}
    story = []
    kind = "MÜŞTERİ HAKEDİŞİ" if h["type"] == "musteri" else "TAŞERON HAKEDİŞİ"
    header(story, kind, str(h["number"]), h["date"])
    info_table(story, [("Şantiye", site.get("name")), ("Cari Hesap", acc.get("name")), ("Dönem", h.get("period")),
                       ("Durum", {"taslak": "Taslak", "onaylandi": "Onaylandı", "odendi": "Ödendi"}.get(h["status"], h["status"]))])
    story.append(Paragraph("Hakediş Cetveli", S_H))
    story.append(Spacer(1, 2 * mm))
    items_table(story, h["items"])
    rows = [("Ara Toplam", tl(h["subtotal"]), False)]
    if h.get("overhead_amount"):
        rows.append((f"Genel Gider Kesintisi (%{int(h['overhead_rate'] * 100)})", f"- {tl(h['overhead_amount'])}", False))
    if h.get("retention_amount"):
        rows.append((f"Teminat Kesintisi (%{h['retention_rate']:g})", f"- {tl(h['retention_amount'])}", False))
    if h.get("previous_deduction"):
        rows.append(("Önceki Hakediş / Avans Kesintisi", f"- {tl(h['previous_deduction'])}", False))
    rows += [("KDV Matrahı", tl(h["base_amount"]), False), (f"KDV (%{h['vat_rate']:g})", tl(h["vat_amount"]), False),
             ("NET ÖDENECEK", tl(h["net_amount"]), True)]
    totals_table(story, rows)
    if h.get("notes"):
        story += [Paragraph("Notlar", S_H), Paragraph(h["notes"].replace("\n", "<br/>"), S_BODY), Spacer(1, 4 * mm)]
    if h.get("terms"):
        story += [Paragraph("Şartlar", S_H), Paragraph(h["terms"].replace("\n", "<br/>"), S_BODY), Spacer(1, 4 * mm)]
    if h.get("technical_spec"):
        story += [Paragraph("Teknik Şartname", S_H), Paragraph(h["technical_spec"].replace("\n", "<br/>"), S_BODY), Spacer(1, 4 * mm)]
    if h.get("ai_summary"):
        story += [Paragraph("Yapay Zeka Özeti", S_H), Paragraph(h["ai_summary"].replace("\n", "<br/>"), S_BODY)]
    story += [Spacer(1, 14 * mm)]
    sig = Table([[Paragraph("Hazırlayan", S_LABEL), Paragraph("Kontrol Eden", S_LABEL), Paragraph("Onaylayan", S_LABEL)]],
                colWidths=[56 * mm, 56 * mm, 56 * mm])
    sig.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.5, MUTED), ("TOPPADDING", (0, 0), (-1, -1), 4)]))
    story.append(sig)
    return pdf_response(build(story), f"hakedis-{h['number']}.pdf")


@router.get("/proposal/{pid}")
async def proposal_pdf(pid: str, user=Depends(get_current_user)):
    p = await db.proposals.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı")
    acc = await db.accounts.find_one({"id": p.get("account_id")}, {"_id": 0}) if p.get("account_id") else None
    story = []
    header(story, "FİYAT TEKLİFİ", p["number"], p["date"], company="DEVRANTAŞ YAPI MİMARLIK İNŞAAT LTD. ŞTİ.")
    rows = [("Sayın", (acc or {}).get("name") or p.get("customer_name")), ("Proje / İş", p["title"])]
    if p.get("project_type"): rows.append(("Proje Türü", p["project_type"]))
    if p.get("location"): rows.append(("Konum", p["location"]))
    if p.get("area_m2"): rows.append(("Alan", f"{p['area_m2']:g} m²"))
    info_table(story, rows)
    if p.get("intro_text"):
        story += [Paragraph(p["intro_text"], S_BODY), Spacer(1, 4 * mm)]
    if p.get("ai_text"):
        story += [Paragraph("Teklif Metni", S_H), Spacer(1, 2 * mm)]
        for para in p["ai_text"].split("\n"):
            if para.strip():
                story.append(Paragraph(para.strip(), S_BODY))
        story.append(Spacer(1, 5 * mm))
    if p.get("items"):
        story += [Paragraph("Fiyat Tablosu", S_H), Spacer(1, 2 * mm)]
        items_table(story, p["items"])
        rows = [("Ara Toplam", tl(p["subtotal"]), False)]
        if p.get("discount"):
            rows.append(("İskonto", f"- {tl(p['discount'])}", False))
        rows += [(f"KDV (%{p['vat_rate']:g})", tl(p["vat_amount"]), False), ("GENEL TOPLAM", tl(p["total"]), True)]
        totals_table(story, rows)
    if p.get("notes"):
        story += [Paragraph("Şartlar ve Notlar", S_H), Paragraph(p["notes"].replace("\n", "<br/>"), S_BODY), Spacer(1, 3 * mm)]
    story += [Paragraph(f"Teklif geçerlilik süresi: {p.get('validity_days', 15)} gündür.", S_BODY), Spacer(1, 16 * mm)]
    sig = Table([[Paragraph("Müşteri Onayı", S_LABEL), Paragraph("DEVRANTAŞ YAPI MİMARLIK<br/>Kaşe / İmza", S_LABEL)]], colWidths=[85 * mm, 85 * mm])
    sig.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.5, MUTED), ("TOPPADDING", (0, 0), (-1, -1), 4), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    story.append(sig)
    return pdf_response(build(story), f"teklif-{p['number']}.pdf")


@router.get("/statement/{account_id}")
async def statement_pdf(account_id: str, detailed: bool = False, user=Depends(get_current_user)):
    from routers.accounts import statement
    data = await statement(account_id, user)
    acc, rows = data["account"], data["rows"]
    story = []
    header(story, "DETAYLI CARİ EKSTRE" if detailed else "CARİ EKSTRE", acc["name"], __import__("datetime").date.today().isoformat())
    info_table(story, [("Cari Tipi", "Müşteri" if acc["type"] == "musteri" else "Taşeron"), ("Telefon", acc.get("phone")), ("Vergi No", acc.get("tax_no")),
                       ("Toplam Hakediş", tl(acc["total_progress"])), ("Toplam Ödenen", tl(acc["total_paid"])), ("Bakiye", tl(acc["balance"]))])
    heads = ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"]
    table = [[Paragraph(h, S_CELL_B) for h in heads]]
    for r in rows:
        desc = r["description"] if detailed else {"hakedis": "Hakediş", "odeme": "Ödeme/Tahsilat", "avans": "Avans", "cek": "Çek"}[r["type"]]
        table.append([Paragraph(r["date"] or "", S_CELL), Paragraph(desc, S_CELL), Paragraph(tl(r["debit"]) if r["debit"] else "", S_CELL),
                      Paragraph(tl(r["credit"]) if r["credit"] else "", S_CELL), Paragraph(tl(r["balance"]), S_CELL)])
    t = Table(table, colWidths=[24 * mm, 76 * mm, 24 * mm, 24 * mm, 22 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), CREAM), ("LINEBELOW", (0, 0), (-1, 0), 0.8, GOLD),
                           ("GRID", (0, 1), (-1, -1), 0.3, colors.HexColor("#E7E5E4")), ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(t)
    return pdf_response(build(story), f"ekstre-{acc['name']}.pdf")


@router.get("/contract/{cid}")
async def contract_pdf(cid: str, user=Depends(get_current_user)):
    from routers.contracts import get_contract
    c = await get_contract(cid, user)
    story = []
    header(story, "SÖZLEŞME", c["number"], c["date"], company="DEVRANTAŞ YAPI MİMARLIK İNŞAAT LTD. ŞTİ.")
    info_table(story, [("Taraf", c.get("party_name")), ("Taraf Tipi", "Müşteri (İşveren)" if c["party_type"] == "musteri" else "Taşeron (Yüklenici)"),
                       ("Şantiye", c.get("site_name")), ("İşin Adı", c["title"]), ("Başlangıç", c.get("start_date")), ("Bitiş", c.get("end_date")),
                       ("Süre", f"{c['duration_days']} gün" if c.get("duration_days") else None)])
    if c.get("items"):
        story += [Paragraph("Birim Fiyat Cetveli", S_H), Spacer(1, 2 * mm)]
        items_table(story, c["items"])
        rows = [("Ara Toplam", tl(c["subtotal"]), False), (f"KDV (%{c['vat_rate']:g})", tl(c["vat_amount"]), False), ("SÖZLEŞME BEDELİ", tl(c["total"]), True)]
        totals_table(story, rows)
    for head, key in [("Ödeme Şartları", "payment_terms"), ("Sözleşme Şartları", "terms"), ("Teknik Şartname", "technical_spec"), ("Notlar", "notes")]:
        if c.get(key):
            story += [Paragraph(head, S_H), Paragraph(c[key].replace("\n", "<br/>"), S_BODY), Spacer(1, 4 * mm)]
    story.append(Spacer(1, 14 * mm))
    left, right = ("İŞVEREN<br/>Kaşe / İmza", "YÜKLENİCİ<br/>DEVRANTAŞ YAPI MİMARLIK<br/>Kaşe / İmza") if c["party_type"] == "musteri" else ("YÜKLENİCİ (TAŞERON)<br/>Kaşe / İmza", "İŞVEREN<br/>DEVRANTAŞ YAPI MİMARLIK<br/>Kaşe / İmza")
    sig = Table([[Paragraph(left, S_LABEL), Paragraph(right, S_LABEL)]], colWidths=[85 * mm, 85 * mm])
    sig.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.5, MUTED), ("TOPPADDING", (0, 0), (-1, -1), 4), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    story.append(sig)
    return pdf_response(build(story), f"sozlesme-{c['number']}.pdf")
