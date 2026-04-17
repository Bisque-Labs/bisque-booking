"""FastAPI dependency injection — session, current user, providers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth import decode_access_token
from app.services.noop_providers import NoopCalendarProvider, NoopEmailProvider, NoopWebhookProvider
from app.services.protocols import CalendarProvider, EmailProvider, WebhookProvider


# ---------------------------------------------------------------------------
# Database session
# ---------------------------------------------------------------------------

DbSession = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Current user (from signed session cookie)
# ---------------------------------------------------------------------------


async def get_current_user(
    request: Request,
    db: DbSession,
) -> User:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_optional_user(
    request: Request,
    db: DbSession,
) -> User | None:
    try:
        return await get_current_user(request, db)
    except HTTPException:
        return None


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    from app.models.user import UserRole
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
AdminUser = Annotated[User, Depends(require_admin)]


# ---------------------------------------------------------------------------
# Provider dependencies — swap these in tests or when real credentials exist
# ---------------------------------------------------------------------------


def get_calendar_provider() -> CalendarProvider:
    """Return the active calendar provider.

    Override in tests via app.dependency_overrides[get_calendar_provider].
    Phase 1: returns NoopCalendarProvider.
    Phase 1b: returns GoogleCalendarProvider when credentials are set.
    """
    from app.config import get_settings
    settings = get_settings()
    if settings.google_client_id and settings.google_client_secret:
        from app.services.google_calendar import GoogleCalendarProvider
        return GoogleCalendarProvider()
    return NoopCalendarProvider()


def get_email_provider() -> EmailProvider:
    """Return the active email provider."""
    from app.config import get_settings
    settings = get_settings()
    if settings.smtp_host and settings.smtp_host != "localhost":
        from app.services.smtp_email import SmtpEmailProvider
        return SmtpEmailProvider()
    return NoopEmailProvider()


def get_webhook_provider() -> WebhookProvider:
    return NoopWebhookProvider()


CalendarDep = Annotated[CalendarProvider, Depends(get_calendar_provider)]
EmailDep = Annotated[EmailProvider, Depends(get_email_provider)]
WebhookDep = Annotated[WebhookProvider, Depends(get_webhook_provider)]
