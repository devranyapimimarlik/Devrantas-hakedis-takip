import secrets
from fastapi import APIRouter, Depends, HTTPException, Response
from core import db, require_role, now_iso, site_summary, account_balance, get_object, logger

router = APIRouter(tags=["portal"])


@router.post("/accounts/{account_id}/portal-token")
async def create_portal_token(account_id: str, user=Depends(require_role("yonetici", "muhasebe"))):
    acc = await db.accounts.find_one({"id": account_id, "type": "musteri"}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="Müşteri bulunamadı")
    token = acc.get("portal_token") or secrets.token_urlsafe(24)
    await db.accounts.update_one({"id": account_id}, {"$set": {"portal_token": token, "portal_enabled": True, "portal_created_at": now_iso()}})
    return {"token": token}


@router.delete("/accounts/{account_id}/portal-token")
async def revoke_portal_token(account_id: str, user=Depends(require_role("yonetici", "muhasebe"))):
    await db.accounts.update_one({"id": account_id}, {"$set": {"portal_enabled": False}, "$unset": {"portal_token": ""}})
    return {"ok": True}


async def _acc_by_token(token: str) -> dict:
    acc = await db.accounts.find_one({"portal_token": token, "portal_enabled": True}, {"_id": 0})
    if not acc:
        raise HTTPException(status_code=404, detail="Bağlantı geçersiz veya kapatılmış")
    return acc


@router.get("/portal/{token}")
async def portal(token: str):
    acc = await _acc_by_token(token)
    from routers.settings import get_settings
    s = await get_settings()
    bal = await account_balance(acc)
    sites = []
    async for site in db.sites.find({"customer_id": acc["id"]}, {"_id": 0}):
        sm = await site_summary(site)
        photos = await db.site_photos.find({"site_id": site["id"]}, {"_id": 0, "id": 1, "file_id": 1, "date": 1, "note": 1, "progress_percent": 1}).sort("date", -1).to_list(60)
        sites.append({"id": site["id"], "name": site["name"], "location": site.get("location"), "status": site.get("status"),
                      "start_date": site.get("start_date"), "end_date": site.get("end_date"), "progress_percent": sm["progress_percent"],
                      "contract_amount": sm["contract_amount"], "total_income": sm["total_income"], "collection_rate": sm["collection_rate"], "photos": photos})
    haks = await db.progress_payments.find({"account_id": acc["id"], "status": {"$in": ["onaylandi", "odendi"]}},
                                           {"_id": 0, "id": 1, "number": 1, "date": 1, "period": 1, "subtotal": 1, "vat_amount": 1, "net_amount": 1, "status": 1, "site_id": 1, "items": 1}).sort("date", -1).to_list(200)
    site_names = {x["id"]: x["name"] for x in sites}
    for h in haks:
        h["site_name"] = site_names.get(h["site_id"])
    pays = await db.transactions.find({"account_id": acc["id"], "type": "gelir", "status": "onaylandi"},
                                      {"_id": 0, "id": 1, "date": 1, "amount": 1, "kasa": 1, "category": 1, "description": 1}).sort("date", -1).to_list(500)
    return {"company": {"name": s["company_name"], "short_name": s["short_name"], "phone": s.get("phone"), "email": s.get("email"), "address": s.get("address"), "primary_color": s["primary_color"]},
            "customer": {"name": acc["name"]}, "balance": bal, "sites": sites, "progress_payments": haks, "payments": pays, "generated_at": now_iso()}


@router.get("/portal/{token}/photo/{file_id}")
async def portal_photo(token: str, file_id: str):
    acc = await _acc_by_token(token)
    site_ids = [s["id"] async for s in db.sites.find({"customer_id": acc["id"]}, {"_id": 0, "id": 1})]
    if not await db.site_photos.find_one({"file_id": file_id, "site_id": {"$in": site_ids}}):
        raise HTTPException(status_code=404, detail="Fotoğraf bulunamadı")
    rec = await db.files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    try:
        data, ctype = get_object(rec["storage_path"])
    except Exception as e:
        logger.error(f"Portal photo failed: {e}")
        raise HTTPException(status_code=502, detail="Dosya alınamadı")
    return Response(content=data, media_type=rec.get("content_type") or ctype, headers={"Cache-Control": "private, max-age=600"})


TEST_PREFIXES = ("TEST_", "Test_", "test_", "TEST ", "QA_")


@router.post("/admin/cleanup-test-data")
async def cleanup_test_data(user=Depends(require_role("yonetici"))):
    def rx():
        return {"$regex": "^(" + "|".join(TEST_PREFIXES) + ")"}
    report = {}
    acc_ids = [a["id"] async for a in db.accounts.find({"name": rx()}, {"_id": 0, "id": 1})]
    site_ids = [s["id"] async for s in db.sites.find({"name": rx()}, {"_id": 0, "id": 1})]
    report["accounts"] = (await db.accounts.delete_many({"id": {"$in": acc_ids}})).deleted_count
    report["sites"] = (await db.sites.delete_many({"id": {"$in": site_ids}})).deleted_count
    rel = {"$or": [{"account_id": {"$in": acc_ids}}, {"site_id": {"$in": site_ids}}]}
    hak_ids = [h["id"] async for h in db.progress_payments.find(rel, {"_id": 0, "id": 1})]
    report["progress_payments"] = (await db.progress_payments.delete_many(rel)).deleted_count
    tx_q = {"$or": rel["$or"] + [{"description": rx()}, {"progress_payment_id": {"$in": hak_ids}}]}
    chk_from_tx = [t["check_id"] async for t in db.transactions.find({**tx_q, "check_id": {"$ne": None}}, {"_id": 0, "check_id": 1})]
    report["transactions"] = (await db.transactions.delete_many(tx_q)).deleted_count
    chk_q = {"$or": rel["$or"] + [{"id": {"$in": chk_from_tx}}, {"bank": rx()}, {"check_no": rx()}, {"drawer": rx()}]}
    chk_ids = [c["id"] async for c in db.checks.find(chk_q, {"_id": 0, "id": 1})]
    report["checks"] = (await db.checks.delete_many(chk_q)).deleted_count
    pay_q = {"$or": [{"title": rx()}, {"site_id": {"$in": site_ids}}]}
    pay_ids = [p["id"] async for p in db.payments.find(pay_q, {"_id": 0, "id": 1})]
    report["payments"] = (await db.payments.delete_many(pay_q)).deleted_count
    report["reminders"] = (await db.reminders.delete_many({"source_id": {"$in": chk_ids + pay_ids}})).deleted_count
    report["proposals"] = (await db.proposals.delete_many({"$or": [{"title": rx()}, {"customer_name": rx()}, {"account_id": {"$in": acc_ids}}]})).deleted_count
    report["contracts"] = (await db.contracts.delete_many({"$or": [{"title": rx()}, {"party_name": rx()}, {"account_id": {"$in": acc_ids}}, {"site_id": {"$in": site_ids}}]})).deleted_count
    report["site_photos"] = (await db.site_photos.delete_many({"$or": [{"site_id": {"$in": site_ids}}, {"note": rx()}]})).deleted_count
    report["users"] = (await db.users.delete_many({"email": {"$regex": "test", "$options": "i"}, "id": {"$ne": user["id"]}, "role": {"$ne": "yonetici"}})).deleted_count
    report["ai_sessions"] = (await db.ai_sessions.delete_many({"title": rx()})).deleted_count
    report["alert_logs"] = (await db.alert_logs.delete_many({"run_id": {"$regex": "^(test|dup-test)"}})).deleted_count
    report["total"] = sum(report.values())
    return report
