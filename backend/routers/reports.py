from fastapi import APIRouter, Depends
from typing import Optional
from datetime import date
from core import db, get_current_user, site_summary, account_balance, r2, OVERHEAD_RATE, SUB_CATEGORIES

router = APIRouter(prefix="/reports", tags=["reports"])


def _date_q(start, end):
    q = {}
    if start: q["$gte"] = start
    if end: q["$lte"] = end
    return q


@router.get("")
async def reports(start: Optional[str] = None, end: Optional[str] = None, site_id: Optional[str] = None,
                  account_id: Optional[str] = None, user=Depends(get_current_user)):
    tq = {"status": "onaylandi"}
    dq = _date_q(start, end)
    if dq: tq["date"] = dq
    if site_id: tq["site_id"] = site_id
    if account_id: tq["account_id"] = account_id
    txs = await db.transactions.find(tq, {"_id": 0}).sort("date", -1).to_list(5000)
    sites_all = await db.sites.find({"id": site_id} if site_id else {}, {"_id": 0}).to_list(500)
    site_names = {s["id"]: s["name"] for s in sites_all}
    accounts = await db.accounts.find({"id": account_id} if account_id else {}, {"_id": 0}).to_list(1000)
    acc_names = {a["id"]: a["name"] for a in accounts}

    income = sum(t["amount"] for t in txs if t["type"] == "gelir")
    expense = sum(t["amount"] for t in txs if t["type"] == "gider")
    today = date.today().isoformat()

    # Kasa (Devrantaş Nakit / Devrantaş Çek)
    nakit = sum(t["amount"] * (1 if t["type"] == "gelir" else -1) for t in txs if t.get("kasa", "nakit") == "nakit")
    cek_kasa = sum(t["amount"] * (1 if t["type"] == "gelir" else -1) for t in txs if t.get("kasa") == "cek")
    movements = [{"id": t["id"], "date": t["date"], "title": t.get("description") or t["category"], "type": t["type"], "category": t["category"],
                  "amount": t["amount"], "site_name": site_names.get(t.get("site_id")), "account_name": acc_names.get(t.get("account_id")),
                  "kasa": t.get("kasa"), "attachment_file_id": t.get("attachment_file_id")} for t in txs[:200]]

    # Kâr/Zarar per site (taşeron hakedişleri gider olarak dahil)
    pl_sites = []
    for s in sites_all:
        sm = await site_summary(s)
        pl_sites.append({"id": s["id"], "name": s["name"], **sm})
    total_overhead = sum(p["overhead_amount"] for p in pl_sites)
    total_expense_pl = sum(p["total_expense"] for p in pl_sites) + sum(t["amount"] for t in txs if t["type"] == "gider" and not t.get("site_id") and t["category"] not in SUB_CATEGORIES)

    # Müşteri risk
    all_checks_q = {} if not account_id else {"account_id": account_id}
    all_checks = await db.checks.find(all_checks_q, {"_id": 0}).to_list(5000)
    risk = []
    for a in accounts:
        if a["type"] != "musteri": continue
        b = await account_balance(a)
        bounced = sum(c["amount"] for c in all_checks if c["account_id"] == a["id"] and c["status"] == "karsiliksiz")
        overdue = sum(c["amount"] for c in all_checks if c["account_id"] == a["id"] and c["status"] == "portfoyde" and c["due_date"] < today)
        score = "dusuk"
        if bounced > 0 or overdue > 0: score = "yuksek"
        elif b["balance"] > 0 and b["total_progress"] and b["balance"] / b["total_progress"] > 0.5: score = "orta"
        risk.append({"id": a["id"], "name": a["name"], **b, "bounced": r2(bounced), "overdue": r2(overdue), "risk": score})
    risk.sort(key=lambda x: {"yuksek": 0, "orta": 1, "dusuk": 2}[x["risk"]])

    # Çek raporu
    check_rows = []
    for c in sorted(all_checks, key=lambda c: c["due_date"]):
        if dq and not ((not start or c["due_date"] >= start) and (not end or c["due_date"] <= end)): continue
        if site_id and c.get("site_id") != site_id: continue
        check_rows.append({**c, "account_name": acc_names.get(c.get("account_id")), "site_name": site_names.get(c.get("site_id")),
                           "days_left": (date.fromisoformat(c["due_date"]) - date.today()).days})
    checks_summary = {"alinan_portfoy": r2(sum(c["amount"] for c in check_rows if c["direction"] == "alinan" and c["status"] == "portfoyde")),
                      "verilen_portfoy": r2(sum(c["amount"] for c in check_rows if c["direction"] == "verilen" and c["status"] == "portfoyde")),
                      "tahsil": r2(sum(c["amount"] for c in check_rows if c["status"] == "tahsil_edildi")),
                      "odenen": r2(sum(c["amount"] for c in check_rows if c["status"] == "odendi")),
                      "karsiliksiz": r2(sum(c["amount"] for c in check_rows if c["status"] == "karsiliksiz"))}

    # Taşeron raporu
    sub_rows = []
    for a in accounts:
        if a["type"] != "taseron": continue
        b = await account_balance(a)
        hq = {"account_id": a["id"], "status": {"$in": ["onaylandi", "odendi"]}}
        if site_id: hq["site_id"] = site_id
        hak = await db.progress_payments.find(hq, {"_id": 0, "number": 1, "net_amount": 1, "date": 1, "status": 1, "site_id": 1}).to_list(500)
        sub_rows.append({"id": a["id"], "name": a["name"], "specialty": a.get("specialty"), **b, "hakedis_count": len(hak),
                         "hakedis": [{**h, "site_name": site_names.get(h.get("site_id"))} for h in hak]})

    # Ödeme / Tahsilat lists
    by_cat = {}
    for t in txs:
        if t["type"] == "gider":
            by_cat[t["category"]] = by_cat.get(t["category"], 0) + t["amount"]

    monthly = {}
    for t in txs:
        m = (t.get("date") or "")[:7]
        if not m: continue
        monthly.setdefault(m, {"month": m, "gelir": 0, "gider": 0})
        monthly[m][t["type"]] += t["amount"]
    cashflow = sorted(monthly.values(), key=lambda x: x["month"])

    pending_payments = await db.payments.find({"status": "bekliyor"}, {"_id": 0}).sort("due_date", 1).to_list(500)

    return {
        "kasa": {"nakit": r2(nakit), "cek_kasasi": r2(cek_kasa), "toplam": r2(nakit + cek_kasa), "movements": movements},
        "kar_zarar": {"gelir": r2(income), "gider": r2(total_expense_pl), "genel_gider": r2(total_overhead),
                      "net": r2(income - total_expense_pl - total_overhead), "sites": pl_sites},
        "musteri_risk": risk,
        "cek": {"summary": checks_summary, "rows": check_rows},
        "odeme": {"toplam": r2(expense), "by_category": [{"category": k, "total": r2(v)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
                  "rows": [m for m in movements if m["type"] == "gider"], "planned": pending_payments},
        "tahsilat": {"toplam": r2(income), "rows": [m for m in movements if m["type"] == "gelir"]},
        "taseron": sub_rows,
        "para_akisi": cashflow,
    }
