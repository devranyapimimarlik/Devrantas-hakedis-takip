import os
import json
import logging
import asyncio
import httpx
from typing import Optional

logger = logging.getLogger("devrantas.native_push")
_apns = {"client": None, "key": None}
_fcm = {"creds": None, "project": None}


def apns_configured() -> bool:
    return bool(_apns.get("pem_override") or os.environ.get("APNS_KEY_P8", "").strip().startswith("-----BEGIN")) and all(os.environ.get(k) for k in ("APNS_KEY_ID", "APNS_TEAM_ID"))


def set_apns_pem(pem: Optional[str]):
    _apns["pem_override"] = pem
    _apns["client"] = None


def fcm_configured() -> bool:
    return bool(_fcm.get("json_override") or os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"))


def set_fcm_json(raw: Optional[str]):
    _fcm["json_override"] = raw
    _fcm["creds"] = None
    _fcm["project"] = None


def _apns_client():
    from aioapns import APNs
    key = (_apns.get("pem_override") or os.environ["APNS_KEY_P8"]).replace("\\n", "\n").strip()
    if _apns["client"] is None or _apns["key"] != key:
        _apns["client"] = APNs(key=key, key_id=os.environ["APNS_KEY_ID"], team_id=os.environ["APNS_TEAM_ID"],
                               topic=os.environ.get("APNS_BUNDLE_ID", "com.devrantas.yapi"),
                               use_sandbox=os.environ.get("APNS_USE_SANDBOX", "true").lower() == "true")
        _apns["key"] = key
    return _apns["client"]


async def send_apns(token: str, title: str, body: str, url: str, tag: Optional[str]) -> str:
    from aioapns import NotificationRequest, PushType
    req = NotificationRequest(device_token=token, message={"aps": {"alert": {"title": title, "body": body}, "sound": "default", "badge": 1, "thread-id": tag or "devrantas"}, "url": url},
                              collapse_key=tag, push_type=PushType.ALERT)
    res = await _apns_client().send_notification(req)
    if res.is_successful:
        return "ok"
    if res.description in ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"):
        return "dead"
    raise RuntimeError(f"APNs {res.status} {res.description}")


def _fcm_token() -> tuple:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    if _fcm["creds"] is None:
        info = json.loads(_fcm.get("json_override") or os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
        _fcm["creds"] = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/firebase.messaging"])
        _fcm["project"] = info["project_id"]
    if not _fcm["creds"].valid:
        _fcm["creds"].refresh(Request())
    return _fcm["creds"].token, _fcm["project"]


async def send_fcm(token: str, title: str, body: str, url: str, tag: Optional[str]) -> str:
    access, project = await asyncio.to_thread(_fcm_token)
    msg = {"message": {"token": token, "notification": {"title": title, "body": body}, "data": {"url": url, "tag": tag or ""},
                       "android": {"priority": "high", "collapse_key": tag or "devrantas", "notification": {"channel_id": "devrantas", "icon": "ic_stat_icon_config_sample", "color": "#B8860B", "click_action": "OPEN_URL"}}}}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"https://fcm.googleapis.com/v1/projects/{project}/messages:send", json=msg, headers={"Authorization": f"Bearer {access}"})
    if r.status_code == 200:
        return "ok"
    if r.status_code in (404, 410) or "UNREGISTERED" in r.text or "INVALID_ARGUMENT" in r.text:
        return "dead"
    raise RuntimeError(f"FCM {r.status_code} {r.text[:200]}")


async def send_native(device: dict, title: str, body: str, url: str, tag: Optional[str]) -> str:
    if device["platform"] == "ios":
        if not apns_configured():
            return "skip"
        return await send_apns(device["token"], title, body, url, tag)
    if device["platform"] == "android":
        if not fcm_configured():
            return "skip"
        return await send_fcm(device["token"], title, body, url, tag)
    return "skip"
