"""Custom middleware — injects current_user into request.state for templates."""

from __future__ import annotations

from fastapi import Request
from fastapi.templating import Jinja2Templates
from sqlalchemy import select

from app.database import get_session_factory
from app.models.user import User
from app.services.auth import decode_access_token


async def add_user_to_request(request: Request, call_next):
    """Inject current_user into request.state so templates can use it."""
    token = request.cookies.get("session")
    request.state.current_user = None

    if token:
        payload = decode_access_token(token)
        if payload and "sub" in payload:
            try:
                async with get_session_factory()() as db:
                    result = await db.execute(
                        select(User).where(User.id == int(payload["sub"]), User.is_active == True)
                    )
                    request.state.current_user = result.scalar_one_or_none()
            except Exception:
                pass

    response = await call_next(request)
    return response


def template_context(request: Request, **extra) -> dict:
    """Build a template context dict that always includes current_user."""
    return {
        "request": request,
        "current_user": getattr(request.state, "current_user", None),
        **extra,
    }
