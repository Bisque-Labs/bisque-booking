"""Booking model — confirmed bookings."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BookingStatus(str, enum.Enum):
    pending = "pending"        # awaiting confirmation (not used in MVP — instant confirm)
    confirmed = "confirmed"
    cancelled = "cancelled"
    rescheduled = "rescheduled"


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type_id: Mapped[int] = mapped_column(
        ForeignKey("event_types.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Client info (no account)
    client_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)

    # Intake form answers + any extra client data
    client_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    # Timing (always UTC in DB)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus), default=BookingStatus.confirmed, nullable=False
    )

    # Google Calendar event ID for deletion on cancel
    google_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Single-use tokens for client-facing actions
    cancel_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    reschedule_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    event_type: Mapped["EventType"] = relationship(back_populates="bookings")

    def __repr__(self) -> str:
        return f"<Booking id={self.id} client={self.client_email!r} start={self.start_at}>"
