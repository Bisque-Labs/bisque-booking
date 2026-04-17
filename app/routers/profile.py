"""User profile management routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from app.templates_env import get_templates
from pydantic import BaseModel
from sqlalchemy import select

from app.dependencies import CurrentUser, DbSession
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profile", tags=["profile"])
templates = get_templates()


class ProfileUpdate(BaseModel):
    name: str
    slug: str
    timezone: str = "UTC"
    video_link: str | None = None


@router.get("", response_class=HTMLResponse)
async def profile_page(request: Request, user: CurrentUser):
    return templates.TemplateResponse(
        "pages/profile.html",
        {"request": request, "user": user},
    )


@router.put("")
async def update_profile(data: ProfileUpdate, user: CurrentUser, db: DbSession):
    from fastapi import HTTPException

    # Ensure slug is unique (if changed)
    if data.slug != user.slug:
        existing = await db.execute(select(User).where(User.slug == data.slug))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Slug already taken")

    user.name = data.name
    user.slug = data.slug
    user.timezone = data.timezone

    # Store video_link on the user's default event types (or just stash it on user model)
    # For now we store it as a note — a future slice adds per-event-type video links

    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "slug": user.slug, "name": user.name, "timezone": user.timezone}


@router.post("/password")
async def change_password(
    request: Request,
    user: CurrentUser,
    db: DbSession,
):
    """Change password for email/password users."""
    from fastapi import HTTPException
    from app.services.auth import hash_password, verify_password

    body = await request.json()
    current = body.get("current_password", "")
    new_pw = body.get("new_password", "")

    if not new_pw or len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if user.hashed_password:
        if not verify_password(current, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password incorrect")

    user.hashed_password = hash_password(new_pw)
    await db.commit()
    return {"updated": True}
