"""Authentication routes — Google OAuth and email/password login."""

from __future__ import annotations

import json
import logging
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select

from app.config import get_settings
from app.dependencies import CurrentUser, DbSession
from app.models.user import User, UserRole
from app.services.auth import (
    create_access_token,
    decrypt_credentials,
    encrypt_credentials,
    generate_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
]


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------


@router.get("/google")
async def google_login(request: Request):
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")

    state = generate_token(16)
    request.session["oauth_state"] = state

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_callback_url,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(code: str, state: str, request: Request, db: DbSession):
    settings = get_settings()
    expected_state = request.session.get("oauth_state")
    if not expected_state or state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_callback_url,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

        # Fetch user info
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_resp.raise_for_status()
        userinfo = userinfo_resp.json()

    google_id = userinfo["sub"]
    email = userinfo["email"]
    name = userinfo.get("name", email.split("@")[0])

    # Find or create user
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if user is None:
        result2 = await db.execute(select(User).where(User.email == email))
        user = result2.scalar_one_or_none()

    if user is None:
        # Check if this is the first user (auto-admin)
        count_result = await db.execute(select(func.count()).select_from(User))
        user_count = count_result.scalar()
        role = UserRole.admin if user_count == 0 else UserRole.consultant

        slug = _slugify(name) or email.split("@")[0]
        slug = await _unique_slug(slug, db)

        user = User(
            email=email,
            name=name,
            slug=slug,
            role=role,
            google_id=google_id,
        )
        db.add(user)

    # Store encrypted credentials
    if settings.encryption_key:
        user.google_credentials_encrypted = encrypt_credentials(json.dumps(tokens))
    user.google_id = google_id

    await db.commit()
    await db.refresh(user)

    return _set_session_cookie(user)


# ---------------------------------------------------------------------------
# Email/password
# ---------------------------------------------------------------------------


class LoginForm(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
async def login(form: LoginForm, db: DbSession):
    result = await db.execute(select(User).where(User.email == form.email, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _set_session_cookie(user)


class RegisterForm(BaseModel):
    email: EmailStr
    name: str
    password: str
    slug: str | None = None


@router.post("/register")
async def register(form: RegisterForm, db: DbSession):
    """Only available during setup (first user) or by admins via the admin dashboard."""
    result = await db.execute(select(User).where(User.email == form.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    count_result = await db.execute(select(func.count()).select_from(User))
    user_count = count_result.scalar()
    role = UserRole.admin if user_count == 0 else UserRole.consultant

    slug = form.slug or _slugify(form.name) or form.email.split("@")[0]
    slug = await _unique_slug(slug, db)

    user = User(
        email=form.email,
        name=form.name,
        slug=slug,
        role=role,
        hashed_password=hash_password(form.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _set_session_cookie(user)


@router.post("/logout")
async def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("session")
    return response


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    from app.templates_env import get_templates
    templates = get_templates()
    error = request.query_params.get("error")
    return templates.TemplateResponse("pages/login.html", {"request": request, "error": error})


@router.post("/login-form")
async def login_form(request: Request, db: DbSession):
    """HTML form-based login (no-JS compatible)."""
    form = await request.form()
    email = str(form.get("email", ""))
    password = str(form.get("password", ""))

    result = await db.execute(select(User).where(User.email == email, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        return RedirectResponse(url="/auth/login?error=Invalid+email+or+password", status_code=303)
    return _set_session_cookie(user)


@router.get("/me")
async def me(user: CurrentUser):
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "slug": user.slug,
        "role": user.role,
        "timezone": user.timezone,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_session_cookie(user: User) -> RedirectResponse:
    token = create_access_token({"sub": str(user.id)})
    response = RedirectResponse(url="/dashboard", status_code=303)
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400)
    return response


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug[:32]


async def _unique_slug(base: str, db) -> str:
    slug = base
    i = 1
    while True:
        result = await db.execute(select(User).where(User.slug == slug))
        if result.scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{i}"
        i += 1
