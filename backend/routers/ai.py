import os
import json
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
from core import db, get_current_user, new_id, now_iso, site_summary, account_balance, OVERHEAD_RATE

router = APIRouter(prefix="/ai", tags=["ai"])
MODEL = ("openai", "gpt-6-sol")

SYSTEM = ("Sen Devrantaş Yapı Mimarlık şirketinin finans ve şantiye yönetimi yapay zeka asistanısın. "
          "Türkçe, profesyonel ve net yanıt ver. Para birimi Türk Lirası (₺). Şirkette her proje tutarından %6 genel gider "
          "kesintisi yapılır. Giderler yönetici onayı olmadan şantiye bakiyesine yansımaz. Verilen finansal verilere dayanarak "
          "somut, sayısal ve uygulanabilir öneriler sun. Markdown başlıklar ve maddeler kullanabilirsin.")


def _chat(session_id: str, system: str = SYSTEM) -> LlmChat:
    return LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=session_id, system_message=system).with_model(*MODEL)


def fmt(v) -> str:
    return f"{float(v or 0):,.2f} ₺".replace(",", "X").replace(".", ",").replace("X", ".")


async def financial_context() -> str:
    sites = await db.sites.find({}, {"_id": 0}).to_list(200)
    lines = ["GENEL FİNANSAL DURUM:"]
    for s in sites:
        sm = await site_summary(s)
        lines.append(f"- Şantiye '{s['name']}' ({s.get('status')}): Sözleşme {fmt(sm['contract_amount'])}, %6 Genel Gider {fmt(sm['overhead_amount'])}, "
                     f"Tahsilat {fmt(sm['total_income'])}, Onaylı Gider {fmt(sm['total_expense'])}, Bekleyen Gider {fmt(sm['pending_expense'])}, "
                     f"Tahmini Kâr {fmt(sm['estimated_profit'])} (%{sm['profit_margin']}), İlerleme %{sm['progress_percent']}, Bütçe Kullanımı %{sm['budget_used_percent']}")
    accounts = await db.accounts.find({}, {"_id": 0}).to_list(500)
    for a in accounts:
        b = await account_balance(a)
        lines.append(f"- Cari '{a['name']}' ({a['type']}): Hakediş {fmt(b['total_progress'])}, Ödenen {fmt(b['total_paid'])}, Bakiye {fmt(b['balance'])}")
    checks = await db.checks.find({"status": "portfoyde"}, {"_id": 0}).sort("due_date", 1).to_list(100)
    for c in checks:
        lines.append(f"- Çek ({c['direction']}): {fmt(c['amount'])} vade {c['due_date']} {c.get('bank', '')}")
    payments = await db.payments.find({"status": "bekliyor"}, {"_id": 0}).sort("due_date", 1).to_list(100)
    for p in payments:
        lines.append(f"- Ödeme ({p['type']}): {p['title']} {fmt(p['amount'])} vade {p['due_date']}")
    return "\n".join(lines)


# ---------- Chat (streaming) ----------
class ChatIn(BaseModel):
    session_id: Optional[str] = None
    message: str


@router.get("/sessions")
async def sessions(user=Depends(get_current_user)):
    rows = await db.ai_sessions.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(50)
    return rows


@router.get("/sessions/{session_id}/messages")
async def messages(session_id: str, user=Depends(get_current_user)):
    return await db.ai_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(500)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user=Depends(get_current_user)):
    await db.ai_sessions.delete_one({"id": session_id, "user_id": user["id"]})
    await db.ai_messages.delete_many({"session_id": session_id})
    return {"ok": True}


@router.post("/chat")
async def chat(data: ChatIn, user=Depends(get_current_user)):
    session_id = data.session_id or new_id()
    sess = await db.ai_sessions.find_one({"id": session_id}, {"_id": 0})
    if not sess:
        await db.ai_sessions.insert_one({"id": session_id, "user_id": user["id"], "title": data.message[:60],
                                         "created_at": now_iso(), "updated_at": now_iso()})
    else:
        await db.ai_sessions.update_one({"id": session_id}, {"$set": {"updated_at": now_iso()}})
    await db.ai_messages.insert_one({"id": new_id(), "session_id": session_id, "role": "user", "content": data.message, "created_at": now_iso()})
    history = await db.ai_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(40)
    ctx = await financial_context()
    hist_txt = "\n".join(f"{'Kullanıcı' if m['role'] == 'user' else 'Asistan'}: {m['content']}" for m in history[:-1][-12:])
    prompt = f"{ctx}\n\nÖNCEKİ KONUŞMA:\n{hist_txt}\n\nKULLANICI SORUSU: {data.message}"
    llm = _chat(session_id)

    async def gen():
        full = ""
        yield f"data: {json.dumps({'session_id': session_id})}\n\n"
        try:
            async for ev in llm.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        if full:
            await db.ai_messages.insert_one({"id": new_id(), "session_id": session_id, "role": "assistant", "content": full, "created_at": now_iso()})
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- Structured generations ----------
async def _generate(prompt: str, session_prefix: str) -> str:
    llm = _chat(f"{session_prefix}-{new_id()}")
    resp = await llm.send_message(UserMessage(text=prompt))
    return resp if isinstance(resp, str) else str(resp)


@router.post("/site-analysis/{site_id}")
async def site_analysis(site_id: str, user=Depends(get_current_user)):
    site = await db.sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Şantiye bulunamadı")
    sm = await site_summary(site)
    exp = await db.transactions.aggregate([{"$match": {"site_id": site_id, "type": "gider", "status": "onaylandi"}},
                                           {"$group": {"_id": "$category", "total": {"$sum": "$amount"}}}]).to_list(50)
    cats = ", ".join(f"{e['_id']}: {fmt(e['total'])}" for e in exp) or "gider yok"
    prompt = (f"Şantiye: {site['name']} ({site.get('location', '')}), durum: {site.get('status')}, başlangıç {site.get('start_date')}, bitiş {site.get('end_date')}.\n"
              f"Sözleşme bedeli {fmt(sm['contract_amount'])}, %6 genel gider {fmt(sm['overhead_amount'])}, net {fmt(sm['net_contract'])}.\n"
              f"Tahsilat {fmt(sm['total_income'])}, onaylı gider {fmt(sm['total_expense'])}, onay bekleyen gider {fmt(sm['pending_expense'])}.\n"
              f"Fiziksel ilerleme %{sm['progress_percent']}, bütçe kullanımı %{sm['budget_used_percent']}, sapma {sm['deviation']} puan.\n"
              f"Gider dağılımı: {cats}.\n\n"
              "Bu şantiye için: 1) Risk analizi (düşük/orta/yüksek ve gerekçe), 2) Bütçe aşım ihtimali tahmini (%), "
              "3) İlerleme-maliyet sapma uyarısı, 4) Nakit akışı önerileri, 5) 3 somut aksiyon maddesi yaz. Kısa ve net ol.")
    text = await _generate(prompt, "site-analysis")
    await db.sites.update_one({"id": site_id}, {"$set": {"ai_analysis": text, "ai_analysis_at": now_iso()}})
    return {"analysis": text}


class ProposalGenIn(BaseModel):
    title: str
    project_type: Optional[str] = ""
    location: Optional[str] = ""
    area_m2: Optional[float] = 0
    customer_name: Optional[str] = ""
    details: Optional[str] = ""
    items: Optional[list] = []


@router.post("/proposal-text")
async def proposal_text(data: ProposalGenIn, user=Depends(get_current_user)):
    items_txt = "\n".join(f"- {i.get('description')}: {i.get('quantity')} {i.get('unit')} x {fmt(i.get('unit_price'))}" for i in (data.items or []))
    prompt = (f"Devrantaş Yapı Mimarlık adına resmi bir teklif mektubu metni hazırla.\nMüşteri: {data.customer_name or 'Sayın Yetkili'}\n"
              f"Proje: {data.title}\nTür: {data.project_type}\nKonum: {data.location}\nAlan: {data.area_m2} m²\nEk bilgi: {data.details}\n"
              f"Kalemler:\n{items_txt or '(kalem girilmedi - alan ve türe göre tahmini kalem ve birim fiyat öner)'}\n\n"
              "Çıktı: 1) Kısa giriş paragrafı, 2) İşin kapsamı maddeleri, 3) Eğer kalem yoksa tahmini maliyet tablosu (madde, miktar, birim fiyat, toplam), "
              "4) Ödeme planı önerisi, 5) Süre, 6) Garanti ve şartlar, 7) Kapanış. Resmi Türkçe, markdown kullanma, düz metin paragraflar ve numaralı maddeler.")
    text = await _generate(prompt, "proposal")
    return {"text": text}


@router.post("/cost-estimate")
async def cost_estimate(data: ProposalGenIn, user=Depends(get_current_user)):
    prompt = (f"Türkiye 2026 piyasa koşullarında {data.project_type or 'inşaat'} projesi için maliyet tahmini yap. Alan {data.area_m2} m², konum {data.location}. "
              f"Ek bilgi: {data.details}. SADECE geçerli JSON döndür, başka metin yazma. Format: "
              '{"items":[{"description":"...","unit":"m²","quantity":0,"unit_price":0}], "summary":"kısa açıklama"}. '
              "6-12 kalem üret, miktar ve birim fiyatları gerçekçi TL olsun.")
    text = await _generate(prompt, "cost")
    try:
        start, end = text.find("{"), text.rfind("}")
        parsed = json.loads(text[start:end + 1])
    except Exception:
        raise HTTPException(status_code=502, detail="Yapay zeka yanıtı çözümlenemedi, tekrar deneyin")
    return parsed


@router.post("/progress-summary/{pid}")
async def progress_summary(pid: str, user=Depends(get_current_user)):
    h = await db.progress_payments.find_one({"id": pid}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Hakediş bulunamadı")
    site = await db.sites.find_one({"id": h["site_id"]}, {"_id": 0, "name": 1})
    acc = await db.accounts.find_one({"id": h["account_id"]}, {"_id": 0, "name": 1})
    items_txt = "\n".join(f"- {i['description']}: {i['quantity']} {i['unit']} x {fmt(i['unit_price'])} = {fmt(i['total'])}" for i in h["items"])
    prompt = (f"Hakediş No {h['number']} ({h['type']}) - Şantiye: {site['name'] if site else ''}, Cari: {acc['name'] if acc else ''}, Tarih {h['date']}, Dönem {h.get('period')}.\n"
              f"Kalemler:\n{items_txt}\nAra toplam {fmt(h['subtotal'])}, %6 genel gider kesintisi {fmt(h['overhead_amount'])}, teminat {fmt(h['retention_amount'])}, "
              f"önceki kesinti {fmt(h['previous_deduction'])}, KDV {fmt(h['vat_amount'])}, NET {fmt(h['net_amount'])}.\n\n"
              "Bu hakediş için yöneticiye sunulacak 4-6 cümlelik profesyonel bir özet yaz ve dikkat edilmesi gereken 2 nokta belirt.")
    text = await _generate(prompt, "hakedis")
    await db.progress_payments.update_one({"id": pid}, {"$set": {"ai_summary": text}})
    return {"summary": text}


@router.post("/financial-analysis")
async def financial_analysis(user=Depends(get_current_user)):
    ctx = await financial_context()
    prompt = (f"{ctx}\n\nŞirket geneli için: 1) Genel finansal sağlık değerlendirmesi, 2) En riskli şantiye ve nedeni, "
              "3) Nakit akışı ve yaklaşan ödemeler hakkında uyarılar, 4) Cari bakiyelerde dikkat edilecek noktalar, 5) 5 öncelikli aksiyon. Kısa ve maddeler halinde.")
    text = await _generate(prompt, "fin")
    return {"analysis": text}
