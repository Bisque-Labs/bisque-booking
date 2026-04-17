"""Client-facing booking flow routes."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from app.templates_env import get_templates
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import CalendarDep, DbSession, EmailDep, WebhookDep
from app.models.booking import Booking, BookingStatus
from app.models.event_type import EventType
from app.models.user import User
from app.services.auth import generate_token
from app.services.availability import detect_timezone_warning, generate_slots_for_date
from app.services.ics import generate_ics

logger = logging.getLogger(__name__)
router = APIRouter(tags=["booking"])
templates = get_templates()


# ---------------------------------------------------------------------------
# Public booking page — /{slug}
# ---------------------------------------------------------------------------


@router.get("/{slug}", response_class=HTMLResponse)
async def booking_page(slug: str, request: Request, db: DbSession):
    result = await db.execute(
        select(User)
        .where(User.slug == slug, User.is_active == True)
        .options(selectinload(User.event_types), selectinload(User.availability_rules))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Booking page not found")

    active_event_types = [et for et in user.event_types if et.is_active]
    return templates.TemplateResponse(
        "pages/booking_page.html",
        {"request": request, "user": user, "event_types": active_event_types},
    )


# ---------------------------------------------------------------------------
# Slot availability API
# ---------------------------------------------------------------------------


@router.get("/{slug}/{event_type_slug}/slots")
async def get_slots(
    slug: str,
    event_type_slug: str,
    target_date: date,
    client_timezone: str = "UTC",
    db: DbSession = None,
    calendar: CalendarDep = None,
):
    """Return available slots for a given date. Called via HTMX."""
    user, event_type = await _load_user_and_event_type(slug, event_type_slug, db)

    # Compute the full busy window for the day
    tz = ZoneInfo(user.timezone)
    day_start = datetime.combine(target_date, datetime.min.time(), tzinfo=tz)
    day_end = day_start + timedelta(days=1)
    day_start_utc = day_start.astimezone(ZoneInfo("UTC"))
    day_end_utc = day_end.astimezone(ZoneInfo("UTC"))

    busy = await calendar.get_free_busy(user.id, day_start_utc, day_end_utc)

    # Also treat confirmed bookings in DB as busy
    db_busy = await _get_db_busy(user.id, day_start_utc, day_end_utc, db)
    all_busy = busy + db_busy

    slots = generate_slots_for_date(
        target_date,
        user.availability_rules,
        all_busy,
        event_type,
        user.timezone,
    )

    # Format slots in both UTC and client timezone
    client_tz = ZoneInfo(client_timezone)
    slot_data = []
    for slot_utc in slots:
        slot_local = slot_utc.astimezone(client_tz)
        end_utc = slot_utc + timedelta(minutes=event_type.duration_minutes)
        warning = detect_timezone_warning(slot_utc, end_utc, user.timezone, client_timezone)
        slot_data.append({
            "utc": slot_utc.isoformat(),
            "local": slot_local.strftime("%I:%M %p"),
            "warning": warning,
        })

    return {"date": target_date.isoformat(), "slots": slot_data}


# ---------------------------------------------------------------------------
# Booking submission
# ---------------------------------------------------------------------------


class BookingRequest(BaseModel):
    slot_utc: datetime
    client_name: str
    client_email: EmailStr
    client_timezone: str = "UTC"
    intake_answers: dict = {}


@router.post("/{slug}/{event_type_slug}/book")
async def create_booking(
    slug: str,
    event_type_slug: str,
    data: BookingRequest,
    db: DbSession,
    calendar: CalendarDep,
    email: EmailDep,
    webhook: WebhookDep,
    request: Request,
):
    user, event_type = await _load_user_and_event_type(slug, event_type_slug, db)

    start_utc = data.slot_utc.replace(tzinfo=ZoneInfo("UTC")) if data.slot_utc.tzinfo is None else data.slot_utc
    end_utc = start_utc + timedelta(minutes=event_type.duration_minutes)

    # Double-check slot is still available
    day_start = start_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    busy = await calendar.get_free_busy(user.id, day_start, day_end)
    db_busy = await _get_db_busy(user.id, day_start, day_end, db)

    from app.services.availability import _overlaps_any_busy
    slot_end_with_buffer = end_utc + timedelta(minutes=event_type.buffer_minutes)
    if _overlaps_any_busy(start_utc, slot_end_with_buffer, busy + db_busy):
        raise HTTPException(status_code=409, detail="Slot no longer available")

    # Create the booking
    booking = Booking(
        event_type_id=event_type.id,
        client_email=data.client_email,
        client_name=data.client_name,
        client_timezone=data.client_timezone,
        client_data=data.intake_answers,
        start_at=start_utc,
        end_at=end_utc,
        status=BookingStatus.confirmed,
        cancel_token=generate_token(),
        reschedule_token=generate_token(),
    )
    db.add(booking)
    await db.flush()

    # Create calendar event
    description = f"Booking with {data.client_name}\n\n"
    if data.intake_answers:
        for k, v in data.intake_answers.items():
            description += f"{k}: {v}\n"

    try:
        event_id = await calendar.create_event(
            user.id,
            f"{event_type.title} — {data.client_name}",
            start_utc,
            end_utc,
            description=description,
            attendee_email=data.client_email,
            create_meet_link=True,
        )
        booking.google_event_id = event_id
    except Exception as exc:
        logger.warning("Calendar event creation failed: %s", exc)

    await db.commit()
    await db.refresh(booking)

    base_url = str(request.base_url).rstrip("/")
    cancel_url = f"{base_url}/bookings/{booking.cancel_token}/cancel"
    reschedule_url = f"{base_url}/bookings/{booking.reschedule_token}/reschedule"

    # Generate ICS
    ics = generate_ics(
        uid=f"booking-{booking.id}@bisque-booking",
        title=f"{event_type.title} with {user.name}",
        start=start_utc,
        end=end_utc,
        organizer_email=user.email,
        organizer_name=user.name,
        attendee_email=data.client_email,
        attendee_name=data.client_name,
        description=description,
        location=event_type.video_link or event_type.location or "",
    )

    # Send confirmation emails
    try:
        await email.send_confirmation_to_client(
            booking_id=booking.id,
            client_email=data.client_email,
            client_name=data.client_name,
            consultant_name=user.name,
            start=start_utc,
            end=end_utc,
            client_timezone=data.client_timezone,
            cancel_url=cancel_url,
            reschedule_url=reschedule_url,
            video_link=event_type.video_link,
            ics_content=ics,
        )
        await email.send_confirmation_to_consultant(
            booking_id=booking.id,
            consultant_email=user.email,
            consultant_name=user.name,
            client_name=data.client_name,
            client_email=data.client_email,
            client_data=data.intake_answers,
            start=start_utc,
            end=end_utc,
            consultant_timezone=user.timezone,
            cancel_url=cancel_url,
            ics_content=ics,
        )
    except Exception as exc:
        logger.error("Email sending failed: %s", exc)

    # Fire webhook
    await webhook.dispatch("booking.created", {
        "booking_id": booking.id,
        "client_email": booking.client_email,
        "start_at": start_utc.isoformat(),
        "end_at": end_utc.isoformat(),
        "event_type": event_type.slug,
        "consultant_slug": user.slug,
    })

    return {
        "booking_id": booking.id,
        "start_at": start_utc.isoformat(),
        "end_at": end_utc.isoformat(),
        "cancel_url": cancel_url,
        "reschedule_url": reschedule_url,
    }


# ---------------------------------------------------------------------------
# Cancel / reschedule
# ---------------------------------------------------------------------------


@router.get("/bookings/{token}/cancel")
async def cancel_booking(token: str, db: DbSession, email: EmailDep, calendar: CalendarDep, request: Request):
    result = await db.execute(
        select(Booking)
        .where(Booking.cancel_token == token)
        .options(selectinload(Booking.event_type).selectinload(EventType.user))
    )
    booking = result.scalar_one_or_none()
    if booking is None or booking.status == BookingStatus.cancelled:
        raise HTTPException(status_code=404, detail="Booking not found or already cancelled")

    booking.status = BookingStatus.cancelled
    if booking.google_event_id:
        try:
            await calendar.delete_event(booking.event_type.user_id, booking.google_event_id)
        except Exception as exc:
            logger.warning("Calendar delete failed: %s", exc)

    await db.commit()

    # Send cancellation emails
    user = booking.event_type.user
    try:
        await email.send_cancellation(
            booking.id, booking.client_email, booking.client_name,
            booking.start_at, booking.end_at, booking.client_timezone,
        )
        await email.send_cancellation(
            booking.id, user.email, user.name,
            booking.start_at, booking.end_at, user.timezone,
        )
    except Exception as exc:
        logger.error("Cancellation email failed: %s", exc)

    return {"status": "cancelled"}


@router.get("/bookings/{token}/reschedule")
async def reschedule_redirect(token: str, db: DbSession):
    """Cancel the current booking and redirect to the booking page to pick a new slot."""
    result = await db.execute(
        select(Booking)
        .where(Booking.reschedule_token == token)
        .options(selectinload(Booking.event_type).selectinload(EventType.user))
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")

    user = booking.event_type.user
    event_type = booking.event_type
    booking.status = BookingStatus.rescheduled

    await db.commit()
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"/{user.slug}/{event_type.slug}", status_code=303)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_user_and_event_type(slug: str, event_type_slug: str, db) -> tuple[User, EventType]:
    result = await db.execute(
        select(User)
        .where(User.slug == slug, User.is_active == True)
        .options(selectinload(User.availability_rules))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    et_result = await db.execute(
        select(EventType).where(EventType.user_id == user.id, EventType.slug == event_type_slug, EventType.is_active == True)
    )
    event_type = et_result.scalar_one_or_none()
    if event_type is None:
        raise HTTPException(status_code=404, detail="Event type not found")

    return user, event_type


async def _get_db_busy(user_id: int, start: datetime, end: datetime, db) -> list[tuple[datetime, datetime]]:
    """Get confirmed bookings for a user as busy intervals."""
    result = await db.execute(
        select(Booking)
        .join(EventType)
        .where(
            EventType.user_id == user_id,
            Booking.status == BookingStatus.confirmed,
            Booking.start_at < end,
            Booking.end_at > start,
        )
    )
    return [(b.start_at, b.end_at) for b in result.scalars()]
