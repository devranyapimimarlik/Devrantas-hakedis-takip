from core import db, logger, init_storage, ensure_kasalar
import os
import logging
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware
from routers import auth, accounts, sites, transactions, progress, checks, proposals, files, ai, pdf, dashboard, reports, contracts, alerts, settings, portal, push, voice, migrate, kasalar, whatsapp, receipt, downloads

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

app = FastAPI(title="Devrantaş Yapı Mimarlık ERP")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Devrantaş Yapı Mimarlık ERP API"}


for r in (auth, accounts, sites, transactions, progress, checks, proposals, files, ai, pdf, dashboard, reports, contracts, alerts, settings, portal, push, voice, migrate, kasalar, whatsapp, receipt, downloads):
    api_router.include_router(r.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await auth.seed_admin()
    await db.reminders.create_index([("remind_date", 1), ("dismissed", 1)])
    await db.transactions.create_index([("site_id", 1), ("status", 1)])
    await db.alert_logs.create_index("run_id", unique=True)
    await db.transactions.create_index([("created_by", 1), ("client_key", 1)], unique=True, partialFilterExpression={"client_key": {"$type": "string"}})
    await push.load_apns_key_from_db()
    await ensure_kasalar()
    await backfill_overhead_virman()
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


async def backfill_overhead_virman():
    from routers.transactions import create_overhead_virman
    admin = await db.users.find_one({"role": "yonetici"}, {"_id": 0, "id": 1, "name": 1}) or {"id": "system", "name": "Sistem"}
    n = 0
    async for h in db.progress_payments.find({"type": "musteri", "status": {"$in": ["onaylandi", "odendi"]}, "overhead_tx_id": {"$exists": False}}, {"_id": 0}):
        if await create_overhead_virman(h, admin):
            n += 1
    if n:
        logger.info(f"%6 genel gider virmanı oluşturuldu: {n} hakediş")


@app.on_event("shutdown")
async def shutdown_db_client():
    from core import client
    client.close()
