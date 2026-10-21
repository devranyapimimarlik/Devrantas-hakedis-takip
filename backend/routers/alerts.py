import os
import hmac
import logging
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError
from typing import Optional
from core import db, get_current_user, require_role, new_id, now_iso, site_summary, account_balance, r2

router = APIRouter(tags=["alerts"])
logger = logging.getLogger("devrantas.alerts")


def tl(v) -> str:
    return f"{float(v or 0):,.0f} ₺".replace(",", ".")


async def build_daily_summary() -> dict:
    today = date.today()
    ts = today.isoformat()
    # 1) Vadesi yaklaşan / geçen çek ve ödemeler (<= 3 gün)
    due_items = []
    async for c in db.checks.find({"status": "portfoyde"}, {"_id": 0}):
        d = (date.fromisoformat(c["due_date"]) - today).days
        if d <= 3:
            acc = await db.accounts.find_one({"id": c.get("account_id")}, {"_id": 0, "name": 1}) if c.get("account_id") else None
            due_items.append({"type": "cek", "title": f"{'Alınan' if c['direction'] == 'alinan' else 'Verilen'} çek {c.get('bank', '')} {c.get('check_no', '')} - {(acc or {}).get('name', '')}".strip(),
                              "amount": c["amount"], "due_date": c["due_date"], "days_left": d})
    async for p in db.payments.find({"status": "bekliyor"}, {"_id": 0}):
        d = (date.fromisoformat(p["due_date"]) - today).days
        if d <= 3:
            due_items.append({"type": p["type"], "title": p["title"], "amount": p["amount"], "due_date": p["due_date"], "days_left": d})
    due_items.sort(key=lambda x: x["due_date"])

    # 2) Zarar riski
    loss_risks = []
    async for s in db.sites.find({"status": {"$in": ["devam", "planlama"]}}, {"_id": 0}):
        sm = await site_summary(s)
        reasons = []
        if sm["estimated_profit"] < 0: reasons.append(f"tahmini kâr negatif ({tl(sm['estimated_profit'])})")
        elif sm["contract_amount"] and sm["profit_margin"] < 10: reasons.append(f"kâr marjı düşük (%{sm['profit_margin']})")
        if sm["deviation"] > 15: reasons.append(f"bütçe kullanımı (%{sm['budget_used_percent']}) ilerlemenin (%{sm['progress_percent']}) {sm['deviation']} puan önünde")
        if sm["budget_used_percent"] > 90: reasons.append(f"bütçenin %{sm['budget_used_percent']}'i tükendi")
        if reasons:
            loss_risks.append({"site_id": s["id"], "site": s["name"], "reasons": reasons, "estimated_profit": sm["estimated_profit"]})

    # 3) Müşteri riski > %33
    customer_risks = []
    async for a in db.accounts.find({"type": "musteri"}, {"_id": 0}):
        b = await account_balance(a)
        if b["total_progress"] > 0:
            ratio = b["balance"] / b["total_progress"] * 100
            overdue = await db.checks.count_documents({"account_id": a["id"], "status": "portfoyde", "due_date": {"$lt": ts}})
            bounced = await db.checks.count_documents({"account_id": a["id"], "status": "karsiliksiz"})
            if ratio > 33 or overdue or bounced:
                customer_risks.append({"account_id": a["id"], "name": a["name"], "ratio": r2(ratio), "balance": b["balance"],
                                       "total_progress": b["total_progress"], "overdue_checks": overdue, "bounced_checks": bounced})

    # 4) Şüpheli / hatalı kayıtlar
    anomalies = []
    seen = {}
    three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    for t in await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000):
        key = (t["type"], t.get("account_id"), t.get("site_id"), t["amount"], t["date"])
        if key in seen:
            anomalies.append({"kind": "mukerrer", "text": f"Mükerrer olabilir: {t['date']} {t['category']} {tl(t['amount'])} ({t.get('description') or '-'})", "ref_id": t["id"]})
        seen[key] = True
        if t["date"] > ts:
            anomalies.append({"kind": "ileri_tarih", "text": f"İleri tarihli kayıt: {t['date']} {t['category']} {tl(t['amount'])}", "ref_id": t["id"]})
        if t["type"] == "gider" and not t.get("site_id") and t["category"] in ("Malzeme", "Nakliye", "İşçilik", "Taşeron Hakediş Ödemesi"):
            anomalies.append({"kind": "santiyesiz", "text": f"Şantiye seçilmemiş gider: {t['date']} {t['category']} {tl(t['amount'])}", "ref_id": t["id"]})
        if t["type"] == "gider" and t["status"] == "onay_bekliyor" and t["created_at"] < three_days_ago:
            anomalies.append({"kind": "bekleyen_onay", "text": f"3 günden uzun süredir onay bekliyor: {t['date']} {t['category']} {tl(t['amount'])}", "ref_id": t["id"]})
        if t["amount"] >= 1_000_000:
            anomalies.append({"kind": "yuksek_tutar", "text": f"Olağandışı yüksek tutar: {t['date']} {t['category']} {tl(t['amount'])}", "ref_id": t["id"]})
    async for a in db.accounts.find({"type": "taseron"}, {"_id": 0}):
        b = await account_balance(a)
        if b["balance"] < 0 and b["total_progress"] > 0:
            anomalies.append({"kind": "fazla_odeme", "text": f"Taşerona hakedişten fazla ödeme: {a['name']} ({tl(-b['balance'])} fazla)", "ref_id": a["id"]})
    async for h in db.progress_payments.find({"status": "taslak"}, {"_id": 0}):
        if h["created_at"] < (datetime.now(timezone.utc) - timedelta(days=7)).isoformat():
            anomalies.append({"kind": "taslak_hakedis", "text": f"7 günden eski taslak hakediş: No {h['number']} {tl(h['net_amount'])}", "ref_id": h["id"]})

    # Mesaj metni
    lines = [f"*DEVRANTAŞ GÜNLÜK ÖZET — {today.strftime('%d.%m.%Y')}*", ""]
    if due_items:
        lines.append("*⏰ Vadesi yaklaşan ödemeler/çekler:*")
        for i in due_items[:12]:
            when = "BUGÜN" if i["days_left"] == 0 else (f"{-i['days_left']} gün GECİKTİ" if i["days_left"] < 0 else f"{i['days_left']} gün kaldı")
            lines.append(f"• {i['title']} — {tl(i['amount'])} — {i['due_date']} ({when})")
    else:
        lines.append("✅ 3 gün içinde vadesi dolan çek/ödeme yok.")
    lines.append("")
    if loss_risks:
        lines.append("*⚠️ Zarar riski:*")
        for r in loss_risks: lines.append(f"• {r['site']}: {'; '.join(r['reasons'])}")
    else:
        lines.append("✅ Zarar riski taşıyan şantiye yok.")
    lines.append("")
    if customer_risks:
        lines.append("*🔴 Müşteri riski (>%33 tahsil edilmemiş):*")
        for r in customer_risks: lines.append(f"• {r['name']}: bakiye {tl(r['balance'])} / hakediş {tl(r['total_progress'])} (%{r['ratio']})" + (f", {r['overdue_checks']} vadesi geçmiş çek" if r['overdue_checks'] else "") + (f", {r['bounced_checks']} karşılıksız çek" if r['bounced_checks'] else ""))
    else:
        lines.append("✅ Riskli müşteri yok.")
    lines.append("")
    if anomalies:
        lines.append(f"*📝 Kontrol edilmesi gereken kayıtlar ({len(anomalies)}):*")
        for a in anomalies[:10]: lines.append(f"• {a['text']}")
    else:
        lines.append("✅ Şüpheli kayıt bulunmadı.")
    return {"date": ts, "due_items": due_items, "loss_risks": loss_risks, "customer_risks": customer_risks, "anomalies": anomalies,
            "message": "\n".join(lines), "alert_count": len(due_items) + len(loss_risks) + len(customer_risks) + len(anomalies)}


def twilio_configured() -> bool:
    return bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN") and (os.environ.get("TWILIO_WHATSAPP_FROM") or os.environ.get("TWILIO_SMS_FROM")))


def send_twilio(message: str, to: str) -> dict:
    from twilio.rest import Client
    client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
    results = {}
    wa_from = os.environ.get("TWILIO_WHATSAPP_FROM")
    sms_from = os.environ.get("TWILIO_SMS_FROM")
    if wa_from:
        m = client.messages.create(body=message[:1500], from_=f"whatsapp:{wa_from.replace('whatsapp:', '')}", to=f"whatsapp:{to}")
        results["whatsapp"] = m.sid
    if sms_from:
        m = client.messages.create(body=message[:1500], from_=sms_from, to=to)
        results["sms"] = m.sid
    return results


async def run_daily_job(run_id: str):
    summary = await build_daily_summary()
    to = os.environ.get("MANAGER_PHONE", "")
    status, detail = "kaydedildi", None
    if twilio_configured() and to:
        try:
            detail = send_twilio(summary["message"], to)
            status = "gonderildi"
        except Exception as e:
            logger.error(f"Twilio send failed: {e}")
            status, detail = "hata", str(e)
    else:
        status = "twilio_yok"
    await db.alert_logs.update_one({"run_id": run_id}, {"$set": {"date": summary["date"], "message": summary["message"],
                                   "alert_count": summary["alert_count"], "status": status, "detail": detail, "to": to, "finished_at": now_iso()}})


@router.get("/alerts/daily-summary")
async def daily_summary(user=Depends(get_current_user)):
    s = await build_daily_summary()
    s["twilio_configured"] = twilio_configured()
    s["manager_phone"] = os.environ.get("MANAGER_PHONE", "")
    return s


class SendIn(BaseModel):
    to: Optional[str] = None


@router.post("/alerts/send")
async def send_now(data: SendIn, user=Depends(require_role("yonetici"))):
    if not twilio_configured():
        raise HTTPException(status_code=400, detail="Twilio yapılandırılmadı. backend/.env içine TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ve TWILIO_WHATSAPP_FROM / TWILIO_SMS_FROM ekleyin.")
    to = data.to or os.environ.get("MANAGER_PHONE")
    summary = await build_daily_summary()
    try:
        res = send_twilio(summary["message"], to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Twilio hatası: {e}")
    await db.alert_logs.insert_one({"id": new_id(), "run_id": f"manual-{new_id()}", "date": summary["date"], "message": summary["message"],
                                    "alert_count": summary["alert_count"], "status": "gonderildi", "detail": res, "to": to, "created_at": now_iso()})
    return {"ok": True, "result": res}


@router.get("/alerts/history")
async def history(user=Depends(get_current_user)):
    return await db.alert_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(30)


@router.post("/cron/daily-reminders")
async def cron_daily(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Yetkisiz")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("X-Webhook-Id") or (body or {}).get("run_id") or new_id()
    try:
        await db.alert_logs.insert_one({"id": new_id(), "run_id": run_id, "status": "kuyrukta", "date": date.today().isoformat(),
                                        "message": "", "alert_count": 0, "created_at": now_iso()})
    except DuplicateKeyError:
        return {"ok": True, "duplicate": True}
    background.add_task(run_daily_job, run_id)
    return {"ok": True, "queued": True, "run_id": run_id}
