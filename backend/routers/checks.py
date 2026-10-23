from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta
from core import db, get_current_user, new_id, now_iso, today_str

router = APIRouter(tags=["checks"])

REMINDER_OFFSETS = [7, 3, 0]


async def create_reminders(source_type: str, source_id: str, title: str, amount: float, due_date: str):
    await db.reminders.delete_many({"source_id": source_id})
    due = date.fromisoformat(due_date)
    docs = []
    for off in REMINDER_OFFSETS:
        docs.append({"id": new_id(), "source_type": source_type, "source_id": source_id, "title": title,
                     "amount": amount, "due_date": due_date, "remind_date": (due - timedelta(days=off)).isoformat(),
                     "days_before": off, "dismissed": False, "created_at": now_iso()})
    await db.reminders.insert_many(docs)


# ---------- Checks (Çek) ----------
class CheckIn(BaseModel):
    direction: str  # alinan | verilen
    account_id: Optional[str] = None
    site_id: Optional[str] = None
    bank: Optional[str] = ""
    check_no: Optional[str] = ""
    drawer: Optional[str] = ""
    amount: float
    issue_date: Optional[str] = None
    due_date: str
    image_file_id: Optional[str] = None
    notes: Optional[str] = ""


async def _enrich_check(c: dict) -> dict:
    if c.get("account_id"):
        a = await db.accounts.find_one({"id": c["account_id"]}, {"_id": 0, "name": 1})
        c["account_name"] = a["name"] if a else None
    if c.get("site_id"):
        s = await db.sites.find_one({"id": c["site_id"]}, {"_id": 0, "name": 1})
        c["site_name"] = s["name"] if s else None
    c["days_left"] = (date.fromisoformat(c["due_date"]) - date.today()).days
    return c


@router.get("/checks")
async def list_checks(direction: Optional[str] = None, status: Optional[str] = None, user=Depends(get_current_user)):
    q = {}
    if direction: q["direction"] = direction
    if status: q["status"] = status
    rows = await db.checks.find(q, {"_id": 0}).sort("due_date", 1).to_list(1000)
    return [await _enrich_check(c) for c in rows]


@router.post("/checks", status_code=201)
async def create_check(data: CheckIn, user=Depends(get_current_user)):
    if data.direction not in ("alinan", "verilen"):
        raise HTTPException(status_code=400, detail="Yön alinan veya verilen olmalı")
    doc = {"id": new_id(), **data.model_dump(), "status": "portfoyde", "created_at": now_iso(), "created_by": user["id"]}
    await db.checks.insert_one(doc)
    doc.pop("_id", None)
    label = "Alınan Çek" if data.direction == "alinan" else "Verilen Çek"
    await create_reminders("cek", doc["id"], f"{label} - {data.bank or ''} {data.check_no or ''}".strip(), data.amount, data.due_date)
    return await _enrich_check(doc)


@router.put("/checks/{cid}")
async def update_check(cid: str, data: CheckIn, user=Depends(get_current_user)):
    res = await db.checks.update_one({"id": cid}, {"$set": data.model_dump()})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Çek bulunamadı")
    label = "Alınan Çek" if data.direction == "alinan" else "Verilen Çek"
    await create_reminders("cek", cid, f"{label} - {data.bank or ''} {data.check_no or ''}".strip(), data.amount, data.due_date)
    c = await db.checks.find_one({"id": cid}, {"_id": 0})
    return await _enrich_check(c)


class CheckStatusIn(BaseModel):
    status: str  # portfoyde | tahsil_edildi | odendi | karsiliksiz | ciro_edildi


@router.patch("/checks/{cid}/status")
async def check_status(cid: str, data: CheckStatusIn, user=Depends(get_current_user)):
    if data.status not in ("portfoyde", "tahsil_edildi", "odendi", "karsiliksiz", "ciro_edildi"):
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    res = await db.checks.update_one({"id": cid}, {"$set": {"status": data.status}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Çek bulunamadı")
    if data.status != "portfoyde":
        await db.reminders.update_many({"source_id": cid}, {"$set": {"dismissed": True}})
    return {"ok": True}


@router.delete("/checks/{cid}")
async def delete_check(cid: str, user=Depends(get_current_user)):
    await db.checks.delete_one({"id": cid})
    await db.reminders.delete_many({"source_id": cid})
    return {"ok": True}


class EndorseIn(BaseModel):
    account_id: str
    progress_payment_id: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = ""


@router.post("/checks/{cid}/endorse", status_code=201)
async def endorse_check(cid: str, data: EndorseIn, user=Depends(get_current_user)):
    from routers.transactions import TransactionIn, create_transaction
    c = await db.checks.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Çek bulunamadı")
    if c["direction"] != "alinan" or c["status"] != "portfoyde":
        raise HTTPException(status_code=400, detail="Sadece portföydeki alınan çekler ciro edilebilir")
    acc = await db.accounts.find_one({"id": data.account_id, "type": "taseron"}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="Taşeron bulunamadı")
    h = None
    if data.progress_payment_id:
        h = await db.progress_payments.find_one({"id": data.progress_payment_id, "account_id": data.account_id}, {"_id": 0})
        if not h or h["status"] == "taslak":
            raise HTTPException(status_code=400, detail="Onaylı bir hakediş seçin")
    desc = data.description or f"Çek cirosu {c.get('bank', '')} {c.get('check_no', '')}" + (f" - Hakediş No {h['number']}" if h else "")
    tx = TransactionIn(site_id=(h or {}).get("site_id") or c.get("site_id"), account_id=data.account_id, type="gider",
                       category="Taşeron Hakediş Ödemesi" if h else "Taşeron Avansı", amount=c["amount"], date=data.date or today_str(),
                       description=desc.strip(), kasa="cek", attachment_file_id=c.get("image_file_id"))
    doc = await create_transaction(tx, user)
    upd = {"check_id": cid, "endorsed": True}
    if h:
        upd["progress_payment_id"] = h["id"]
    await db.transactions.update_one({"id": doc["id"]}, {"$set": upd})
    await db.checks.update_one({"id": cid}, {"$set": {"status": "ciro_edildi", "endorsed_to": data.account_id, "endorsed_to_name": acc["name"],
                                                     "endorsed_at": now_iso(), "endorse_transaction_id": doc["id"]}})
    await db.reminders.update_many({"source_id": cid}, {"$set": {"dismissed": True}})
    return {"ok": True, "transaction": {**doc, **upd}}


# ---------- Scheduled payments (Kira / Kart / Kredi) ----------
class PaymentIn(BaseModel):
    type: str  # kira | kredi_karti | kredi | diger
    title: str
    amount: float
    due_date: str
    site_id: Optional[str] = None
    notes: Optional[str] = ""


@router.get("/calendar")
async def calendar(month: str, user=Depends(get_current_user)):
    try:
        y, m = (int(x) for x in month.split("-")[:2])
        start = date(y, m, 1)
    except Exception:
        raise HTTPException(status_code=400, detail="Ay formatı YYYY-MM olmalı")
    end = date(y + (m // 12), (m % 12) + 1, 1)
    rng = {"$gte": start.isoformat(), "$lt": end.isoformat()}
    sites = {s["id"]: s["name"] async for s in db.sites.find({}, {"_id": 0, "id": 1, "name": 1})}
    accounts = {a["id"]: a["name"] async for a in db.accounts.find({}, {"_id": 0, "id": 1, "name": 1})}
    items = []
    async for c in db.checks.find({"due_date": rng}, {"_id": 0}):
        items.append({"id": c["id"], "kind": "cek", "direction": c["direction"], "date": c["due_date"], "amount": c["amount"], "status": c["status"],
                      "title": f"{'Alınan' if c['direction'] == 'alinan' else 'Verilen'} çek · {c.get('bank') or ''} {c.get('check_no') or ''}".strip(),
                      "party": accounts.get(c.get("account_id")) or c.get("drawer") or c.get("endorsed_to_name") or "", "site": sites.get(c.get("site_id")) or "",
                      "open": c["status"] == "portfoyde"})
    async for p in db.payments.find({"due_date": rng}, {"_id": 0}):
        items.append({"id": p["id"], "kind": p.get("type") or "diger", "direction": "verilen", "date": p["due_date"], "amount": p["amount"], "status": p["status"],
                      "title": p["title"], "party": p.get("notes") or "", "site": "", "open": p["status"] == "bekliyor"})
    items.sort(key=lambda x: (x["date"], -x["amount"]))
    today = date.today().isoformat()
    for it in items:
        it["days_left"] = (date.fromisoformat(it["date"]) - date.today()).days
    days = {}
    for it in items:
        d = days.setdefault(it["date"], {"date": it["date"], "in": 0.0, "out": 0.0, "count": 0, "open": 0})
        d["count"] += 1
        d["open"] += 1 if it["open"] else 0
        if it["open"]:
            d["in" if it["direction"] == "alinan" else "out"] += float(it["amount"] or 0)
    tot_in = sum(d["in"] for d in days.values())
    tot_out = sum(d["out"] for d in days.values())
    return {"month": f"{y:04d}-{m:02d}", "today": today, "days": sorted(days.values(), key=lambda d: d["date"]), "items": items,
            "totals": {"in": tot_in, "out": tot_out, "net": tot_in - tot_out, "open_count": sum(1 for i in items if i["open"])}}


@router.get("/payments")
async def list_payments(status: Optional[str] = None, user=Depends(get_current_user)):
    q = {"status": status} if status else {}
    rows = await db.payments.find(q, {"_id": 0}).sort("due_date", 1).to_list(1000)
    for p in rows:
        p["days_left"] = (date.fromisoformat(p["due_date"]) - date.today()).days
    return rows


@router.post("/payments", status_code=201)
async def create_payment(data: PaymentIn, user=Depends(get_current_user)):
    if data.type not in ("kira", "kredi_karti", "kredi", "diger"):
        raise HTTPException(status_code=400, detail="Geçersiz ödeme tipi")
    doc = {"id": new_id(), **data.model_dump(), "status": "bekliyor", "created_at": now_iso(), "created_by": user["id"]}
    await db.payments.insert_one(doc)
    doc.pop("_id", None)
    await create_reminders(data.type, doc["id"], data.title, data.amount, data.due_date)
    doc["days_left"] = (date.fromisoformat(doc["due_date"]) - date.today()).days
    return doc


@router.patch("/payments/{pid}/paid")
async def pay_payment(pid: str, user=Depends(get_current_user)):
    res = await db.payments.update_one({"id": pid}, {"$set": {"status": "odendi", "paid_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Ödeme bulunamadı")
    await db.reminders.update_many({"source_id": pid}, {"$set": {"dismissed": True}})
    return {"ok": True}


@router.delete("/payments/{pid}")
async def delete_payment(pid: str, user=Depends(get_current_user)):
    await db.payments.delete_one({"id": pid})
    await db.reminders.delete_many({"source_id": pid})
    return {"ok": True}


# ---------- Reminders ----------
@router.get("/reminders")
async def list_reminders(user=Depends(get_current_user)):
    today = today_str()
    rows = await db.reminders.find({"dismissed": False, "remind_date": {"$lte": today}, "due_date": {"$gte": today}},
                                   {"_id": 0}).sort("due_date", 1).to_list(500)
    overdue = await db.reminders.find({"dismissed": False, "due_date": {"$lt": today}, "days_before": 0},
                                      {"_id": 0}).sort("due_date", 1).to_list(500)
    latest = {}
    for r in rows:
        key = r["source_id"]
        if key not in latest or r["days_before"] < latest[key]["days_before"]:
            latest[key] = r
    buckets = {"today": [], "three_days": [], "seven_days": [], "overdue": overdue}
    for r in latest.values():
        days_left = (date.fromisoformat(r["due_date"]) - date.today()).days
        r["days_left"] = days_left
        if days_left <= 0:
            buckets["today"].append(r)
        elif days_left <= 3:
            buckets["three_days"].append(r)
        else:
            buckets["seven_days"].append(r)
    for r in overdue:
        r["days_left"] = (date.fromisoformat(r["due_date"]) - date.today()).days
    buckets["total"] = sum(len(v) for v in buckets.values())
    return buckets


@router.patch("/reminders/{rid}/dismiss")
async def dismiss(rid: str, user=Depends(get_current_user)):
    r = await db.reminders.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Hatırlatıcı bulunamadı")
    await db.reminders.update_many({"source_id": r["source_id"]}, {"$set": {"dismissed": True}})
    return {"ok": True}
