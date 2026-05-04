"""EventType model — booking page configurations per consultant."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventType(Base):
    __tablename__ = "event_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    buffer_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    min_notice_hours: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    max_horizon_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    color: Mapped[str] = mapped_column(String(7), default="#2563eb", nullable=False)
    location: Mapped[str | None] = mapped_column(String(512), nullable=True)
    video_link: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Custom intake questions: list of {label, required, type}
    intake_questions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="event_types")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="event_type", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<EventType id={self.id} slug={self.slug!r} duration={self.duration_minutes}m>"
