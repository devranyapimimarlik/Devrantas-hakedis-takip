from fastapi import APIRouter, Depends
from datetime import date
from core import db, get_current_user, site_summary, r2

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(user=Depends(get_current_user)):
    sites = await db.sites.find({}, {"_id": 0}).to_list(200)
    site_rows, agg = [], {"contract": 0, "overhead": 0, "income": 0, "expense": 0, "pending": 0, "profit": 0, "realized_profit": 0, "realized_overhead": 0}
    for s in sites:
        sm = await site_summary(s)
        site_rows.append({"id": s["id"], "name": s["name"], "status": s.get("status"), **sm})
        agg["contract"] += sm["contract_amount"]; agg["overhead"] += sm["overhead_amount"]
        agg["income"] += sm["total_income"]; agg["expense"] += sm["total_expense"]
        agg["pending"] += sm["pending_expense"]; agg["profit"] += sm["estimated_profit"]
        agg["realized_profit"] += sm["realized_profit"]; agg["realized_overhead"] += sm["realized_overhead"]
    pending_count = await db.transactions.count_documents({"status": "onay_bekliyor"})
    monthly = {}
    async for t in db.transactions.find({"status": "onaylandi"}, {"_id": 0, "date": 1, "type": 1, "amount": 1}):
        m = (t.get("date") or "")[:7]
        if not m:
            continue
        monthly.setdefault(m, {"month": m, "gelir": 0, "gider": 0})
        monthly[m][t["type"]] += t["amount"]
    cashflow = sorted(monthly.values(), key=lambda x: x["month"])[-12:]
    for c in cashflow:
        c["gelir"], c["gider"] = r2(c["gelir"]), r2(c["gider"])
    today = date.today().isoformat()
    checks_in = await db.checks.aggregate([{"$match": {"status": "portfoyde", "direction": "alinan"}},
                                           {"$group": {"_id": None, "t": {"$sum": "$amount"}, "c": {"$sum": 1}}}]).to_list(1)
    checks_out = await db.checks.aggregate([{"$match": {"status": "portfoyde", "direction": "verilen"}},
                                            {"$group": {"_id": None, "t": {"$sum": "$amount"}, "c": {"$sum": 1}}}]).to_list(1)
    recent = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(8)
    kasa = {}
    async for r in db.transactions.aggregate([{"$match": {"status": "onaylandi"}}, {"$group": {"_id": {"k": "$kasa", "t": "$type"}, "s": {"$sum": "$amount"}}}]):
        k = r["_id"].get("k") or "nakit"
        kasa[k] = kasa.get(k, 0) + (r["s"] if r["_id"]["t"] == "gelir" else -r["s"])
    cats = await db.transactions.aggregate([{"$match": {"type": "gider", "status": "onaylandi"}},
                                            {"$group": {"_id": "$category", "total": {"$sum": "$amount"}}},
                                            {"$sort": {"total": -1}}]).to_list(8)
    return {
        "totals": {k: r2(v) for k, v in agg.items()},
        "profit_margin": r2(agg["profit"] / agg["contract"] * 100) if agg["contract"] else 0,
        "pending_approvals": pending_count,
        "site_count": len(sites), "active_sites": sum(1 for s in sites if s.get("status") == "devam"),
        "sites": site_rows, "cashflow": cashflow,
        "checks_in": {"total": r2(checks_in[0]["t"]) if checks_in else 0, "count": checks_in[0]["c"] if checks_in else 0},
        "checks_out": {"total": r2(checks_out[0]["t"]) if checks_out else 0, "count": checks_out[0]["c"] if checks_out else 0},
        "recent": recent, "expense_categories": [{"category": c["_id"], "total": r2(c["total"])} for c in cats],
        "kasa": {"nakit": r2(kasa.get("nakit", 0)), "cek": r2(kasa.get("cek", 0)), "toplam": r2(kasa.get("nakit", 0) + kasa.get("cek", 0))},
        "today": today,
    }
