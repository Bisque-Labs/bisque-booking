"""
Availability computation — pure functional slot generation.

Given a user's availability rules, a set of busy intervals from a calendar
provider, and an event type configuration, compute the list of bookable slots
for a date range.

All datetimes are timezone-aware. Slot generation is intentionally pure
(no I/O) so it's trivially unit-testable.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models.availability import AvailabilityRule
from app.models.event_type import EventType


def _to_utc(dt: datetime) -> datetime:
    """Ensure datetime is in UTC."""
    return dt.astimezone(ZoneInfo("UTC"))


def generate_slots_for_date(
    target_date: date,
    rules: list[AvailabilityRule],
    busy_intervals: list[tuple[datetime, datetime]],
    event_type: EventType,
    user_timezone: str,
) -> list[datetime]:
    """Return a list of available slot start times (UTC) for target_date.

    Args:
        target_date: The calendar date to compute slots for.
        rules: The user's AvailabilityRule records.
        busy_intervals: List of (start, end) busy UTC datetimes from the calendar provider.
        event_type: The EventType being booked (determines duration + buffer + notice).
        user_timezone: IANA timezone string for the consultant (e.g. "America/New_York").

    Returns:
        Sorted list of slot start datetimes in UTC that are:
        - Within an availability window
        - Not overlapping any busy interval (including buffer time)
        - After the minimum notice horizon
        - Before the maximum booking horizon
    """
    tz = ZoneInfo(user_timezone)
    day_of_week = target_date.weekday()  # 0=Monday

    # Find rules matching this day of week
    matching_rules = [r for r in rules if r.day_of_week == day_of_week]
    if not matching_rules:
        return []

    now_utc = datetime.now(tz=ZoneInfo("UTC"))
    min_start = now_utc + timedelta(hours=event_type.min_notice_hours)
    max_start = now_utc + timedelta(days=event_type.max_horizon_days)

    slot_duration = timedelta(minutes=event_type.duration_minutes)
    buffer = timedelta(minutes=event_type.buffer_minutes)
    step = slot_duration + buffer  # advance by slot + buffer for next candidate

    slots: list[datetime] = []

    for rule in matching_rules:
        rule_tz = ZoneInfo(rule.timezone)

        # Build window start/end as aware datetimes in the rule's timezone
        window_start = datetime.combine(target_date, rule.start_time, tzinfo=rule_tz)
        window_end = datetime.combine(target_date, rule.end_time, tzinfo=rule_tz)

        # Convert to UTC for comparison
        window_start_utc = _to_utc(window_start)
        window_end_utc = _to_utc(window_end)

        candidate = window_start_utc

        while candidate + slot_duration <= window_end_utc:
            slot_end = candidate + slot_duration
            slot_end_with_buffer = candidate + step

            # Min notice / max horizon checks
            if candidate < min_start or candidate > max_start:
                candidate += timedelta(minutes=15)
                continue

            # Check against every busy interval
            if not _overlaps_any_busy(candidate, slot_end_with_buffer, busy_intervals):
                slots.append(candidate)

            candidate += timedelta(minutes=15)  # 15-minute slot grid

    slots.sort()
    return slots


def _overlaps_any_busy(
    slot_start: datetime,
    slot_end: datetime,
    busy_intervals: list[tuple[datetime, datetime]],
) -> bool:
    """Return True if [slot_start, slot_end) overlaps any busy interval."""
    for busy_start, busy_end in busy_intervals:
        # Overlap condition: not (slot_end <= busy_start or slot_start >= busy_end)
        if slot_start < busy_end and slot_end > busy_start:
            return True
    return False


def get_available_dates(
    start_date: date,
    end_date: date,
    rules: list[AvailabilityRule],
    busy_intervals: list[tuple[datetime, datetime]],
    event_type: EventType,
    user_timezone: str,
) -> list[date]:
    """Return dates in [start_date, end_date] that have at least one bookable slot."""
    available = []
    current = start_date
    while current <= end_date:
        slots = generate_slots_for_date(current, rules, busy_intervals, event_type, user_timezone)
        if slots:
            available.append(current)
        current += timedelta(days=1)
    return available


def detect_timezone_warning(
    slot_start: datetime,
    slot_end: datetime,
    consultant_tz: str,
    client_tz: str,
    early_hour: int = 8,
    late_hour: int = 19,
) -> str | None:
    """Return a warning message if the slot is outside business hours in either timezone.

    Args:
        slot_start: Booking start (UTC, timezone-aware).
        slot_end: Booking end (UTC, timezone-aware).
        consultant_tz: Consultant's IANA timezone.
        client_tz: Client's IANA timezone.
        early_hour: Hour below which a warning is issued (default 8).
        late_hour: Hour at or above which a warning is issued (default 19).

    Returns:
        Warning string if a violation is found, else None.
    """
    warnings = []

    for label, tz_str in [("your consultant", consultant_tz), ("you", client_tz)]:
        tz = ZoneInfo(tz_str)
        local_start = slot_start.astimezone(tz)
        local_end = slot_end.astimezone(tz)

        if local_start.hour < early_hour:
            warnings.append(
                f"Note: this slot starts at {local_start.strftime('%I:%M %p')} for {label} in {tz_str}."
            )
        elif local_start.hour >= late_hour:
            warnings.append(
                f"Note: this slot starts at {local_start.strftime('%I:%M %p')} for {label} in {tz_str}."
            )

    return " ".join(warnings) if warnings else None
