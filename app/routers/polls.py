"""Group availability poll routes."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from app.templates_env import get_templates
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import CalendarDep, CurrentUser, DbSession, EmailDep
from app.models.poll import AvailabilityPoll, PollResponse, PollSlot, PollStatus
from app.services.auth import generate_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/polls", tags=["polls"])
templates = get_templates()


# ---------------------------------------------------------------------------
# Create poll (authenticated)
# ---------------------------------------------------------------------------


class SlotInput(BaseModel):
    start_at: datetime
    end_at: datetime


class PollCreate(BaseModel):
    title: str
    description: str | None = None
    slots: list[SlotInput]
    expires_at: datetime | None = None


@router.post("")
async def create_poll(data: PollCreate, user: CurrentUser, db: DbSession):
    poll = AvailabilityPoll(
        creator_id=user.id,
        title=data.title,
        description=data.description,
        expires_at=data.expires_at,
        share_token=generate_token(),
    )
    db.add(poll)
    await db.flush()

    for slot in data.slots:
        db.add(PollSlot(poll_id=poll.id, start_at=slot.start_at, end_at=slot.end_at))

    await db.commit()
    await db.refresh(poll)
    return {"poll_id": poll.id, "share_token": poll.share_token}


# ---------------------------------------------------------------------------
# View poll (public via share token)
# ---------------------------------------------------------------------------


@router.get("/{share_token}", response_class=HTMLResponse)
async def view_poll(share_token: str, request: Request, db: DbSession):
    result = await db.execute(
        select(AvailabilityPoll)
        .where(AvailabilityPoll.share_token == share_token)
        .options(
            selectinload(AvailabilityPoll.slots),
            selectinload(AvailabilityPoll.responses),
            selectinload(AvailabilityPoll.creator),
        )
    )
    poll = result.scalar_one_or_none()
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")

    # Tally votes per slot
    tally = {slot.id: {"yes": 0, "if_needed": 0, "no": 0} for slot in poll.slots}
    for resp in poll.responses:
        for slot_id_str, answer in resp.responses.items():
            slot_id = int(slot_id_str)
            if slot_id in tally and answer in tally[slot_id]:
                tally[slot_id][answer] += 1

    return templates.TemplateResponse(
        "pages/poll.html",
        {"request": request, "poll": poll, "tally": tally},
    )


# ---------------------------------------------------------------------------
# Submit response (public)
# ---------------------------------------------------------------------------


class PollResponseSubmit(BaseModel):
    participant_email: EmailStr
    participant_name: str
    responses: dict[str, str]  # {slot_id: "yes"|"if_needed"|"no"}


@router.post("/{share_token}/respond")
async def submit_response(share_token: str, data: PollResponseSubmit, db: DbSession):
    result = await db.execute(
        select(AvailabilityPoll).where(AvailabilityPoll.share_token == share_token)
    )
    poll = result.scalar_one_or_none()
    if poll is None or poll.status != PollStatus.open:
        raise HTTPException(status_code=404, detail="Poll not found or closed")

    # Check for existing response from this email
    existing = await db.execute(
        select(PollResponse).where(
            PollResponse.poll_id == poll.id,
            PollResponse.participant_email == data.participant_email,
        )
    )
    resp = existing.scalar_one_or_none()

    if resp:
        resp.responses = data.responses
        resp.participant_name = data.participant_name
    else:
        resp = PollResponse(
            poll_id=poll.id,
            participant_email=data.participant_email,
            participant_name=data.participant_name,
            responses=data.responses,
        )
        db.add(resp)

    await db.commit()
    return {"submitted": True}


# ---------------------------------------------------------------------------
# Confirm winning slot (authenticated creator only)
# ---------------------------------------------------------------------------


@router.post("/{share_token}/confirm/{slot_id}")
async def confirm_poll_slot(
    share_token: str,
    slot_id: int,
    user: CurrentUser,
    db: DbSession,
    email: EmailDep,
    calendar: CalendarDep,
    request: Request,
):
    result = await db.execute(
        select(AvailabilityPoll)
        .where(AvailabilityPoll.share_token == share_token)
        .options(selectinload(AvailabilityPoll.slots), selectinload(AvailabilityPoll.responses))
    )
    poll = result.scalar_one_or_none()
    if poll is None or poll.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    slot_result = await db.execute(select(PollSlot).where(PollSlot.id == slot_id, PollSlot.poll_id == poll.id))
    slot = slot_result.scalar_one_or_none()
    if slot is None:
        raise HTTPException(status_code=404, detail="Slot not found")

    poll.status = PollStatus.confirmed
    poll.confirmed_slot_id = slot.id
    await db.commit()

    # Notify all participants
    base_url = str(request.base_url).rstrip("/")
    for resp in poll.responses:
        try:
            await email.send_poll_confirmation(
                poll_id=poll.id,
                recipient_email=resp.participant_email,
                recipient_name=resp.participant_name,
                poll_title=poll.title,
                start=slot.start_at,
                end=slot.end_at,
                recipient_timezone="UTC",
            )
        except Exception as exc:
            logger.error("Poll confirmation email failed: %s", exc)

    return {"confirmed": True, "slot_start": slot.start_at.isoformat()}


# ---------------------------------------------------------------------------
# List user's polls
# ---------------------------------------------------------------------------


@router.get("")
async def list_polls(user: CurrentUser, db: DbSession):
    result = await db.execute(
        select(AvailabilityPoll)
        .where(AvailabilityPoll.creator_id == user.id)
        .order_by(AvailabilityPoll.created_at.desc())
        .options(selectinload(AvailabilityPoll.slots), selectinload(AvailabilityPoll.responses))
    )
    polls = result.scalars().all()
    return [
        {
            "id": p.id,
            "title": p.title,
            "status": p.status,
            "share_token": p.share_token,
            "expires_at": p.expires_at.isoformat() if p.expires_at else None,
            "response_count": len(p.responses),
            "slot_count": len(p.slots),
        }
        for p in polls
    ]
