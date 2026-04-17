"""Tests for ICS generation."""

from datetime import datetime, timezone

from app.services.ics import generate_cancellation_ics, generate_ics


def test_generate_ics_valid():
    start = datetime(2025, 1, 6, 14, 0, tzinfo=timezone.utc)
    end = datetime(2025, 1, 6, 14, 30, tzinfo=timezone.utc)
    ics = generate_ics(
        uid="test-uid-123",
        title="Strategy Session",
        start=start,
        end=end,
        organizer_email="sarah@example.com",
        organizer_name="Sarah Smith",
        attendee_email="client@example.com",
        attendee_name="John Client",
        description="Discussing Q1 roadmap",
    )
    assert isinstance(ics, bytes)
    content = ics.decode()
    assert "VCALENDAR" in content
    assert "VEVENT" in content
    assert "Strategy Session" in content
    assert "test-uid-123" in content
    assert "REQUEST" in content


def test_generate_cancellation_ics():
    start = datetime(2025, 1, 6, 14, 0, tzinfo=timezone.utc)
    end = datetime(2025, 1, 6, 14, 30, tzinfo=timezone.utc)
    ics = generate_cancellation_ics(
        uid="test-uid-123",
        title="Strategy Session",
        start=start,
        end=end,
        organizer_email="sarah@example.com",
        attendee_email="client@example.com",
    )
    content = ics.decode()
    assert "CANCEL" in content
    assert "CANCELLED" in content
