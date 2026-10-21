from core import db, logger, init_storage
import os
import logging
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware
from routers import auth, accounts, sites, transactions, progress, checks, proposals, files, ai, pdf, dashboard, reports, contracts

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

app = FastAPI(title="Devrantaş Yapı Mimarlık ERP")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Devrantaş Yapı Mimarlık ERP API"}


for r in (auth, accounts, sites, transactions, progress, checks, proposals, files, ai, pdf, dashboard, reports, contracts):
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
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    from core import client
    client.close()
