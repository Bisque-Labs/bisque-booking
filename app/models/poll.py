"""Group availability poll models."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PollStatus(str, enum.Enum):
    open = "open"
    closed = "closed"
    confirmed = "confirmed"


class AvailabilityPoll(Base):
    __tablename__ = "availability_polls"

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[PollStatus] = mapped_column(Enum(PollStatus), default=PollStatus.open, nullable=False)
    share_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_slot_id: Mapped[int | None] = mapped_column(ForeignKey("poll_slots.id", use_alter=True, name="fk_polls_confirmed_slot"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    creator: Mapped["User"] = relationship(back_populates="created_polls")
    slots: Mapped[list["PollSlot"]] = relationship(
        back_populates="poll",
        cascade="all, delete-orphan",
        foreign_keys="PollSlot.poll_id",
    )
    responses: Mapped[list["PollResponse"]] = relationship(back_populates="poll", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<AvailabilityPoll id={self.id} title={self.title!r} status={self.status}>"


class PollSlot(Base):
    __tablename__ = "poll_slots"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("availability_polls.id", ondelete="CASCADE"), nullable=False, index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    poll: Mapped["AvailabilityPoll"] = relationship(back_populates="slots", foreign_keys=[poll_id])


class PollResponse(Base):
    __tablename__ = "poll_responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("availability_polls.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_email: Mapped[str] = mapped_column(String(255), nullable=False)
    participant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # {slot_id: "yes" | "if_needed" | "no"}
    responses: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    poll: Mapped["AvailabilityPoll"] = relationship(back_populates="responses")
