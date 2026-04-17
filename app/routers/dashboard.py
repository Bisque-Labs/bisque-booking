"""Consultant and admin dashboard routes."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from app.templates_env import get_templates
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.dependencies import AdminUser, CurrentUser, DbSession
from app.models.availability import AvailabilityRule
from app.models.booking import Booking, BookingStatus
from app.models.event_type import EventType
from app.models.user import User, UserRole
from app.services.auth import hash_password

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])
templates = get_templates()


# ---------------------------------------------------------------------------
# Consultant dashboard
# ---------------------------------------------------------------------------


@router.get("", response_class=HTMLResponse)
async def dashboard(request: Request, user: CurrentUser, db: DbSession):
    # Upcoming bookings for this consultant
    now = datetime.utcnow()
    result = await db.execute(
        select(Booking)
        .join(EventType)
        .where(
            EventType.user_id == user.id,
            Booking.status == BookingStatus.confirmed,
            Booking.start_at >= now,
        )
        .order_by(Booking.start_at)
        .limit(20)
        .options(selectinload(Booking.event_type))
    )
    upcoming = result.scalars().all()

    return templates.TemplateResponse(
        "pages/dashboard.html",
        {"request": request, "user": user, "upcoming": upcoming},
    )


# ---------------------------------------------------------------------------
# Event type management
# ---------------------------------------------------------------------------


class EventTypeCreate(BaseModel):
    slug: str
    title: str
    description: str | None = None
    duration_minutes: int = 30
    buffer_minutes: int = 0
    min_notice_hours: int = 1
    max_horizon_days: int = 30
    color: str = "#2563eb"
    location: str | None = None
    video_link: str | None = None
    intake_questions: list = []


@router.post("/event-types")
async def create_event_type(data: EventTypeCreate, user: CurrentUser, db: DbSession):
    et = EventType(user_id=user.id, **data.model_dump())
    db.add(et)
    await db.commit()
    await db.refresh(et)
    return {"id": et.id, "slug": et.slug}


@router.put("/event-types/{event_type_id}")
async def update_event_type(event_type_id: int, data: EventTypeCreate, user: CurrentUser, db: DbSession):
    result = await db.execute(
        select(EventType).where(EventType.id == event_type_id, EventType.user_id == user.id)
    )
    et = result.scalar_one_or_none()
    if et is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404)

    for k, v in data.model_dump().items():
        setattr(et, k, v)
    await db.commit()
    return {"id": et.id}


@router.delete("/event-types/{event_type_id}")
async def delete_event_type(event_type_id: int, user: CurrentUser, db: DbSession):
    result = await db.execute(
        select(EventType).where(EventType.id == event_type_id, EventType.user_id == user.id)
    )
    et = result.scalar_one_or_none()
    if et:
        await db.delete(et)
        await db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Availability rules
# ---------------------------------------------------------------------------


class AvailabilityRuleCreate(BaseModel):
    day_of_week: int  # 0=Mon
    start_time: str   # "HH:MM"
    end_time: str
    timezone: str = "UTC"


@router.get("/availability")
async def get_availability(user: CurrentUser, db: DbSession):
    result = await db.execute(select(AvailabilityRule).where(AvailabilityRule.user_id == user.id))
    rules = result.scalars().all()
    return [
        {
            "id": r.id,
            "day_of_week": r.day_of_week,
            "start_time": r.start_time.isoformat(),
            "end_time": r.end_time.isoformat(),
            "timezone": r.timezone,
        }
        for r in rules
    ]


@router.post("/availability")
async def set_availability(rules_data: list[AvailabilityRuleCreate], user: CurrentUser, db: DbSession):
    """Replace all availability rules for the current user."""
    from datetime import time as dtime

    existing = await db.execute(select(AvailabilityRule).where(AvailabilityRule.user_id == user.id))
    for rule in existing.scalars():
        await db.delete(rule)

    for rd in rules_data:
        h, m = map(int, rd.start_time.split(":"))
        start = dtime(h, m)
        h2, m2 = map(int, rd.end_time.split(":"))
        end = dtime(h2, m2)
        db.add(AvailabilityRule(
            user_id=user.id,
            day_of_week=rd.day_of_week,
            start_time=start,
            end_time=end,
            timezone=rd.timezone,
        ))

    await db.commit()
    return {"saved": len(rules_data)}


# ---------------------------------------------------------------------------
# Admin — user management
# ---------------------------------------------------------------------------


class CreateUserForm(BaseModel):
    email: str
    name: str
    password: str
    slug: str | None = None
    role: UserRole = UserRole.consultant
    timezone: str = "UTC"


@router.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(request: Request, user: AdminUser, db: DbSession):
    users_result = await db.execute(select(User).order_by(User.created_at))
    all_users = users_result.scalars().all()

    now = datetime.utcnow()
    bookings_result = await db.execute(
        select(Booking)
        .where(Booking.status == BookingStatus.confirmed, Booking.start_at >= now)
        .order_by(Booking.start_at)
        .limit(50)
        .options(selectinload(Booking.event_type).selectinload(EventType.user))
    )
    upcoming = bookings_result.scalars().all()

    return templates.TemplateResponse(
        "pages/admin.html",
        {"request": request, "user": user, "all_users": all_users, "upcoming": upcoming},
    )


@router.post("/admin/users")
async def admin_create_user(data: CreateUserForm, user: AdminUser, db: DbSession):
    from app.routers.auth import _slugify, _unique_slug
    slug = data.slug or _slugify(data.name) or data.email.split("@")[0]
    slug = await _unique_slug(slug, db)
    new_user = User(
        email=data.email,
        name=data.name,
        slug=slug,
        role=data.role,
        timezone=data.timezone,
        hashed_password=hash_password(data.password),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {"id": new_user.id, "slug": new_user.slug}


@router.put("/admin/users/{user_id}/deactivate")
async def deactivate_user(user_id: int, user: AdminUser, db: DbSession):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if target:
        target.is_active = False
        await db.commit()
    return {"deactivated": True}


# ---------------------------------------------------------------------------
# Analytics (basic)
# ---------------------------------------------------------------------------


@router.get("/admin/stats")
async def admin_stats(user: AdminUser, db: DbSession):
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)

    total = await db.execute(select(func.count()).select_from(Booking).where(Booking.status == BookingStatus.confirmed))
    weekly = await db.execute(
        select(func.count()).select_from(Booking)
        .where(Booking.status == BookingStatus.confirmed, Booking.created_at >= week_ago)
    )
    cancelled = await db.execute(
        select(func.count()).select_from(Booking)
        .where(Booking.status == BookingStatus.cancelled, Booking.created_at >= week_ago)
    )

    return {
        "total_confirmed": total.scalar(),
        "confirmed_last_7d": weekly.scalar(),
        "cancelled_last_7d": cancelled.scalar(),
    }
