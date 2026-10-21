import os
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
from core import (db, hash_password, verify_password, create_access_token, create_refresh_token,
                  set_auth_cookies, public_user, get_current_user, require_role, new_id, now_iso, ROLES)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "muhasebe"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _auth_response(response: Response, user: dict) -> dict:
    access = create_access_token(user["id"], user["email"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": public_user(user), "access_token": access}


@router.post("/register-sub", status_code=201)
async def register_sub(data: RegisterIn, user: dict = Depends(require_role("yonetici"))):
    email = data.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta adresi zaten kayıtlı")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı")
    role = data.role if data.role in ROLES else "muhasebe"
    doc = {"id": new_id(), "email": email, "name": data.name.strip(), "role": role,
           "password_hash": hash_password(data.password), "created_at": now_iso()}
    await db.users.insert_one(doc)
    return public_user(doc)


@router.post("/login")
async def login(data: LoginIn, request: Request, response: Response):
    email = data.email.lower().strip()
    ident = f"{request.client.host if request.client else 'x'}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": ident}, {"_id": 0})
    now = datetime.now(timezone.utc)
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = datetime.fromisoformat(attempt["last_at"]) + timedelta(minutes=15)
        if now < locked_until:
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin")
        await db.login_attempts.delete_one({"identifier": ident})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        await db.login_attempts.update_one({"identifier": ident},
                                           {"$inc": {"count": 1}, "$set": {"last_at": now.isoformat()}}, upsert=True)
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    await db.login_attempts.delete_one({"identifier": ident})
    return _auth_response(response, user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.get("/users")
async def list_users(user: dict = Depends(require_role("yonetici"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(200)
    return users


class RoleIn(BaseModel):
    role: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(data: PasswordIn, user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not verify_password(data.current_password, u["password_hash"]):
        raise HTTPException(status_code=400, detail="Mevcut şifre hatalı")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 6 karakter olmalı")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(data.new_password)}})
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_role("yonetici"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Kendi hesabınızı silemezsiniz")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


@router.patch("/users/{user_id}/role")
async def set_role(user_id: str, data: RoleIn, user: dict = Depends(require_role("yonetici"))):
    if data.role not in ROLES:
        raise HTTPException(status_code=400, detail="Geçersiz rol")
    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    return {"ok": True}


async def seed_admin():
    email = os.environ["ADMIN_EMAIL"].lower()
    password = os.environ["ADMIN_PASSWORD"]
    if not await db.users.find_one({"email": email}):
        await db.users.insert_one({"id": new_id(), "email": email, "name": "Yönetici", "role": "yonetici",
                                   "password_hash": hash_password(password), "created_at": now_iso()})
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
