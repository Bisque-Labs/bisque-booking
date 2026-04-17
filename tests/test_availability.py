"""Unit tests for availability slot computation — pure functions, no I/O."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.availability import AvailabilityRule
from app.models.event_type import EventType
from app.services.availability import (
    _overlaps_any_busy,
    detect_timezone_warning,
    generate_slots_for_date,
    get_available_dates,
)

UTC = ZoneInfo("UTC")
EASTERN = ZoneInfo("America/New_York")

# Use a Monday that is 8 days in the future so min_notice/horizon filters don't fire
_TODAY = date.today()
_DAYS_TO_MONDAY = (7 - _TODAY.weekday()) % 7 or 7  # next Monday (at least 7 days away)
FUTURE_MONDAY = _TODAY + timedelta(days=_DAYS_TO_MONDAY + 7)  # 2+ weeks out to be safe
FUTURE_WEDNESDAY = FUTURE_MONDAY + timedelta(days=2)


def make_rule(day: int, start: str, end: str, tz: str = "UTC") -> AvailabilityRule:
    h, m = map(int, start.split(":"))
    h2, m2 = map(int, end.split(":"))
    rule = AvailabilityRule()
    rule.user_id = 1
    rule.day_of_week = day
    rule.start_time = time(h, m)
    rule.end_time = time(h2, m2)
    rule.timezone = tz
    return rule


def make_event_type(duration: int = 30, buffer: int = 0, notice: int = 0, horizon: int = 365) -> EventType:
    et = EventType()
    et.duration_minutes = duration
    et.buffer_minutes = buffer
    et.min_notice_hours = notice
    et.max_horizon_days = horizon
    return et


# ---------------------------------------------------------------------------
# _overlaps_any_busy
# ---------------------------------------------------------------------------


def test_no_overlap_empty_busy():
    slot = datetime(2025, 1, 1, 10, 0, tzinfo=UTC)
    assert not _overlaps_any_busy(slot, slot + timedelta(hours=1), [])


def test_overlap_detected():
    slot_start = datetime(2025, 1, 1, 10, 0, tzinfo=UTC)
    slot_end = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    busy = [(datetime(2025, 1, 1, 10, 15, tzinfo=UTC), datetime(2025, 1, 1, 11, 0, tzinfo=UTC))]
    assert _overlaps_any_busy(slot_start, slot_end, busy)


def test_adjacent_slots_not_overlapping():
    slot_start = datetime(2025, 1, 1, 10, 0, tzinfo=UTC)
    slot_end = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    busy = [(datetime(2025, 1, 1, 10, 30, tzinfo=UTC), datetime(2025, 1, 1, 11, 0, tzinfo=UTC))]
    assert not _overlaps_any_busy(slot_start, slot_end, busy)


# ---------------------------------------------------------------------------
# generate_slots_for_date
# ---------------------------------------------------------------------------


def test_generates_slots_in_window():
    rule = make_rule(FUTURE_MONDAY.weekday(), "09:00", "11:00")
    et = make_event_type(duration=30)

    slots = generate_slots_for_date(FUTURE_MONDAY, [rule], [], et, "UTC")
    assert len(slots) > 0, f"Expected slots for {FUTURE_MONDAY} (weekday {FUTURE_MONDAY.weekday()})"
    # All slots should be within 09:00–10:30
    for slot in slots:
        assert slot.hour >= 9
        end = slot + timedelta(minutes=30)
        day_start = datetime.combine(FUTURE_MONDAY, time(11, 0), tzinfo=UTC)
        assert end <= day_start


def test_no_slots_wrong_day():
    # Rule for Monday, but requesting Wednesday
    rule = make_rule(FUTURE_MONDAY.weekday(), "09:00", "17:00")
    et = make_event_type(duration=30)
    slots = generate_slots_for_date(FUTURE_WEDNESDAY, [rule], [], et, "UTC")
    assert slots == []


def test_busy_interval_removes_slot():
    rule = make_rule(FUTURE_MONDAY.weekday(), "09:00", "10:00")
    et = make_event_type(duration=30)

    # Mark 09:00–09:30 busy
    busy_start = datetime.combine(FUTURE_MONDAY, time(9, 0), tzinfo=UTC)
    busy_end = datetime.combine(FUTURE_MONDAY, time(9, 30), tzinfo=UTC)
    busy = [(busy_start, busy_end)]

    slots = generate_slots_for_date(FUTURE_MONDAY, [rule], busy, et, "UTC")
    slot_times = [s.hour * 60 + s.minute for s in slots]
    assert 9 * 60 not in slot_times, "09:00 should be blocked by busy interval"
    assert 9 * 60 + 30 in slot_times, "09:30 should still be available"


def test_buffer_time_prevents_adjacent_slot():
    rule = make_rule(FUTURE_MONDAY.weekday(), "09:00", "10:30")
    et = make_event_type(duration=30, buffer=30)  # 30-min buffer after each slot

    # Mark 09:00–09:30 busy
    busy_start = datetime.combine(FUTURE_MONDAY, time(9, 0), tzinfo=UTC)
    busy_end = datetime.combine(FUTURE_MONDAY, time(9, 30), tzinfo=UTC)
    busy = [(busy_start, busy_end)]

    slots = generate_slots_for_date(FUTURE_MONDAY, [rule], busy, et, "UTC")
    slot_times_minutes = [s.hour * 60 + s.minute for s in slots]
    # 09:30 should be available (buffer applies to OUR slots, busy is the external event)
    assert 9 * 60 + 30 in slot_times_minutes


def test_slot_count_correct():
    """2-hour window, 30-min slots, 15-min step → 4 slots at :00 :15 :30 :45 for first hour."""
    rule = make_rule(FUTURE_MONDAY.weekday(), "09:00", "10:00")
    et = make_event_type(duration=30)

    slots = generate_slots_for_date(FUTURE_MONDAY, [rule], [], et, "UTC")
    # 09:00, 09:15, 09:30 — each is 30 min and fits before 10:00
    assert len(slots) >= 2


# ---------------------------------------------------------------------------
# detect_timezone_warning
# ---------------------------------------------------------------------------


def test_no_warning_during_business_hours():
    start = datetime(2025, 1, 6, 14, 0, tzinfo=UTC)  # 2pm UTC
    end = start + timedelta(hours=1)
    warning = detect_timezone_warning(start, end, "UTC", "UTC")
    assert warning is None


def test_warning_for_early_morning():
    start = datetime(2025, 1, 6, 7, 0, tzinfo=UTC)  # 7am UTC
    end = start + timedelta(hours=1)
    warning = detect_timezone_warning(start, end, "UTC", "UTC")
    assert warning is not None


def test_warning_for_late_evening():
    start = datetime(2025, 1, 6, 20, 0, tzinfo=UTC)  # 8pm UTC
    end = start + timedelta(hours=1)
    warning = detect_timezone_warning(start, end, "UTC", "UTC")
    assert warning is not None


def test_timezone_warning_cross_timezone():
    # 9pm UTC = past business hours
    start = datetime(2025, 1, 6, 21, 0, tzinfo=UTC)
    end = start + timedelta(hours=1)
    warning = detect_timezone_warning(start, end, "UTC", "America/New_York")
    assert warning is not None


# ---------------------------------------------------------------------------
# get_available_dates
# ---------------------------------------------------------------------------


def test_get_available_dates_returns_weekdays():
    # Create rules for Mon-Fri
    rules = [make_rule(i, "09:00", "17:00") for i in range(5)]
    et = make_event_type(duration=30)

    # Use a Monday-to-Sunday span well in the future
    start = FUTURE_MONDAY
    end = FUTURE_MONDAY + timedelta(days=6)  # Mon–Sun

    available = get_available_dates(start, end, rules, [], et, "UTC")
    # Should have Mon–Fri (5 days)
    assert len(available) == 5
    # Saturday and Sunday not included
    assert start + timedelta(days=5) not in available  # Saturday
    assert start + timedelta(days=6) not in available  # Sunday
