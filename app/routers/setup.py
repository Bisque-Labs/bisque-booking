"""First-run setup wizard — only available when no users exist."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from app.templates_env import get_templates
from sqlalchemy import func, select

from app.dependencies import DbSession
from app.models.user import User, UserRole
from app.services.auth import create_access_token, hash_password

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/setup", tags=["setup"])
templates = get_templates()


async def _has_users(db) -> bool:
    count = await db.execute(select(func.count()).select_from(User))
    return (count.scalar() or 0) > 0


@router.get("", response_class=HTMLResponse)
async def setup_page(request: Request, db: DbSession):
    if await _has_users(db):
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse("pages/setup.html", {"request": request})


@router.post("")
async def setup_submit(request: Request, db: DbSession):
    if await _has_users(db):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Setup already complete")

    form = await request.form()
    name = str(form.get("name", ""))
    email = str(form.get("email", ""))
    password = str(form.get("password", ""))
    slug_input = str(form.get("slug", "")) or None
    timezone = str(form.get("timezone", "UTC"))

    if not name or not email or not password:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Name, email, and password are required")

    from app.routers.auth import _slugify, _unique_slug
    slug = slug_input or _slugify(name) or email.split("@")[0]
    slug = await _unique_slug(slug, db)

    user = User(
        email=email,
        name=name,
        slug=slug,
        role=UserRole.admin,
        timezone=timezone,
        hashed_password=hash_password(password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    response = RedirectResponse(url="/dashboard", status_code=303)
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=86400)
    return response
