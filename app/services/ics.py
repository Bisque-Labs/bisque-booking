"""ICS calendar file generation — pure function, no I/O."""

from __future__ import annotations

from datetime import datetime

from icalendar import Calendar, Event, vText


def generate_ics(
    uid: str,
    title: str,
    start: datetime,
    end: datetime,
    organizer_email: str,
    organizer_name: str,
    attendee_email: str,
    attendee_name: str,
    description: str = "",
    location: str = "",
) -> bytes:
    """Generate an ICS file for a booking.

    Returns:
        Raw bytes of the ICS file, suitable for use as an email attachment.
    """
    cal = Calendar()
    cal.add("prodid", "-//bisque-booking//bisque-booking//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "REQUEST")

    event = Event()
    event.add("uid", uid)
    event.add("summary", title)
    event.add("dtstart", start)
    event.add("dtend", end)
    event.add("description", description)
    if location:
        event.add("location", location)
    event.add("organizer", f"mailto:{organizer_email}")
    event.add("attendee", f"mailto:{attendee_email}")

    cal.add_component(event)
    return cal.to_ical()


def generate_cancellation_ics(
    uid: str,
    title: str,
    start: datetime,
    end: datetime,
    organizer_email: str,
    attendee_email: str,
) -> bytes:
    """Generate a cancellation ICS (METHOD:CANCEL)."""
    cal = Calendar()
    cal.add("prodid", "-//bisque-booking//bisque-booking//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "CANCEL")

    event = Event()
    event.add("uid", uid)
    event.add("summary", f"Cancelled: {title}")
    event.add("dtstart", start)
    event.add("dtend", end)
    event.add("status", "CANCELLED")
    event.add("organizer", f"mailto:{organizer_email}")
    event.add("attendee", f"mailto:{attendee_email}")

    cal.add_component(event)
    return cal.to_ical()
