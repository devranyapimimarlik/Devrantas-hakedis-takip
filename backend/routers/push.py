import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from core import db, get_current_user, require_role, new_id, now_iso

router = APIRouter(prefix="/push", tags=["push"])
logger = logging.getLogger("devrantas.push")
_vapid = {}


async def get_vapid() -> dict:
    if _vapid:
        return _vapid
    doc = await db.settings.find_one({"id": "vapid"}, {"_id": 0})
    if not doc:
        from py_vapid import Vapid, b64urlencode
        from cryptography.hazmat.primitives import serialization
        v = Vapid()
        v.generate_keys()
        priv = v.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        raw = b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, "big"))
        pub = b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        doc = {"id": "vapid", "private_pem": priv, "private_raw": raw, "public_key": pub, "created_at": now_iso()}
        await db.settings.update_one({"id": "vapid"}, {"$setOnInsert": doc}, upsert=True)
        doc = await db.settings.find_one({"id": "vapid"}, {"_id": 0})
    _vapid.update(doc)
    return _vapid


async def send_push(user_ids: Optional[list], title: str, body: str, url: str = "/", tag: Optional[str] = None, roles: Optional[list] = None) -> dict:
    from pywebpush import webpush, WebPushException
    v = await get_vapid()
    q = {}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    elif roles:
        uids = [u["id"] async for u in db.users.find({"role": {"$in": roles}}, {"_id": 0, "id": 1})]
        q["user_id"] = {"$in": uids}
    subs = await db.push_subscriptions.find(q, {"_id": 0}).to_list(500)
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag or new_id()[:8], "icon": "/api/settings/logo?size=192"})
    sent, dead = 0, []
    for s in subs:
        try:
            webpush(subscription_info=s["subscription"], data=payload, vapid_private_key=v["private_raw"],
                    vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "mailto:admin@devrantas.com")}, ttl=86400)
            sent += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                dead.append(s["subscription"]["endpoint"])
            else:
                logger.error(f"Push failed: {e}")
        except Exception as e:
            logger.error(f"Push error: {e}")
    if dead:
        await db.push_subscriptions.delete_many({"subscription.endpoint": {"$in": dead}})
    native = await _send_native_all(q, title, body, url, tag)
    return {"sent": sent + native["sent"], "removed": len(dead) + native["removed"], "targets": len(subs) + native["targets"], "native": native}


async def _send_native_all(q: dict, title: str, body: str, url: str, tag: Optional[str]) -> dict:
    from native_push import send_native
    devices = await db.push_devices.find(q, {"_id": 0}).to_list(500)
    sent, dead, skipped = 0, [], 0
    for d in devices:
        try:
            r = await send_native(d, title, body, url, tag)
            if r == "ok":
                sent += 1
            elif r == "dead":
                dead.append(d["token"])
            else:
                skipped += 1
        except Exception as e:
            logger.error(f"Native push error ({d['platform']}): {e}")
    if dead:
        await db.push_devices.delete_many({"token": {"$in": dead}})
    return {"sent": sent, "removed": len(dead), "targets": len(devices), "skipped": skipped}


class SubIn(BaseModel):
    subscription: dict
    device: Optional[str] = ""


class UnsubIn(BaseModel):
    endpoint: str


class DeviceIn(BaseModel):
    token: str
    platform: str
    device: Optional[str] = ""


@router.post("/device", status_code=201)
async def register_device(data: DeviceIn, user=Depends(get_current_user)):
    if data.platform not in ("ios", "android") or len(data.token) < 20:
        raise HTTPException(status_code=400, detail="Geçersiz cihaz bilgisi")
    await db.push_devices.update_one({"token": data.token}, {"$set": {"user_id": user["id"], "platform": data.platform, "device": data.device or "", "updated_at": now_iso()},
                                                             "$setOnInsert": {"id": new_id(), "created_at": now_iso()}}, upsert=True)
    return {"ok": True}


@router.delete("/device")
async def remove_device(data: UnsubIn, user=Depends(get_current_user)):
    await db.push_devices.delete_many({"token": data.endpoint, "user_id": user["id"]})
    return {"ok": True}


@router.get("/native-config")
async def native_config(user=Depends(get_current_user)):
    from native_push import apns_configured, fcm_configured
    doc = await db.settings.find_one({"id": "apns_key"}, {"_id": 0, "filename": 1, "updated_at": 1})
    return {"ios": apns_configured(), "android": fcm_configured(), "apns_key_file": doc, "sandbox": os.environ.get("APNS_USE_SANDBOX", "true").lower() == "true",
            "key_id_set": bool(os.environ.get("APNS_KEY_ID")), "team_id_set": bool(os.environ.get("APNS_TEAM_ID"))}


async def load_apns_key_from_db():
    from native_push import set_apns_pem
    doc = await db.settings.find_one({"id": "apns_key"}, {"_id": 0, "pem": 1})
    set_apns_pem(doc["pem"] if doc else None)


@router.post("/apns-key")
async def upload_apns_key(file: UploadFile = File(...), user=Depends(require_role("yonetici"))):
    from cryptography.hazmat.primitives import serialization
    from native_push import set_apns_pem
    raw = (await file.read()).decode("utf-8", "ignore").replace("\r", "").strip()
    try:
        serialization.load_pem_private_key(raw.encode(), None)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçerli bir .p8 anahtar dosyası değil. Apple'dan indirdiğiniz AuthKey_XXXXXXXXXX.p8 dosyasını seçin.")
    await db.settings.update_one({"id": "apns_key"}, {"$set": {"pem": raw, "filename": file.filename, "updated_at": now_iso(), "uploaded_by": user["id"]}}, upsert=True)
    set_apns_pem(raw)
    return {"ok": True, "filename": file.filename}


@router.delete("/apns-key")
async def delete_apns_key(user=Depends(require_role("yonetici"))):
    from native_push import set_apns_pem
    await db.settings.delete_one({"id": "apns_key"})
    set_apns_pem(None)
    return {"ok": True}


@router.get("/vapid-public-key")
async def vapid_public_key(user=Depends(get_current_user)):
    v = await get_vapid()
    return {"public_key": v["public_key"]}


@router.post("/subscribe", status_code=201)
async def subscribe(data: SubIn, user=Depends(get_current_user)):
    ep = data.subscription.get("endpoint")
    if not ep or not data.subscription.get("keys"):
        raise HTTPException(status_code=400, detail="Geçersiz abonelik")
    await db.push_subscriptions.update_one({"subscription.endpoint": ep}, {"$set": {"user_id": user["id"], "subscription": data.subscription, "device": data.device or "",
                                                                                   "updated_at": now_iso()}, "$setOnInsert": {"id": new_id(), "created_at": now_iso()}}, upsert=True)
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(data: UnsubIn, user=Depends(get_current_user)):
    await db.push_subscriptions.delete_many({"subscription.endpoint": data.endpoint, "user_id": user["id"]})
    return {"ok": True}


@router.get("/status")
async def status(user=Depends(get_current_user)):
    n = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    m = await db.push_devices.count_documents({"user_id": user["id"]})
    return {"devices": n + m, "web": n, "native": m}


@router.post("/test")
async def test_push(user=Depends(get_current_user)):
    res = await send_push([user["id"]], "Devrantaş bildirim testi", "Bildirimler bu cihazda çalışıyor.", "/", tag="test")
    if res["targets"] == 0:
        raise HTTPException(status_code=400, detail="Bu hesap için kayıtlı cihaz yok. Önce bildirimleri açın.")
    return res
