"""
Provider protocols — clean API seams for external integrations.

Every external system (Google Calendar, Outlook, SMTP, etc.) implements one
of these protocols. Core logic depends only on the protocol, never on a
concrete implementation. This makes Phase 2 integrations (Outlook, webhooks)
and Phase 3 AI features slot in without touching business logic.

Usage:
    from app.services.protocols import CalendarProvider, EmailProvider

    def compute_slots(cal: CalendarProvider, ...) -> list[Slot]: ...
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


@runtime_checkable
class CalendarProvider(Protocol):
    """Read/write access to a user's calendar.

    Phase 1 implementation: GoogleCalendarProvider
    Phase 2 implementations: OutlookCalendarProvider, MockCalendarProvider
    """

    async def get_free_busy(
        self,
        user_id: int,
        start: datetime,
        end: datetime,
    ) -> list[tuple[datetime, datetime]]:
        """Return list of (start, end) busy intervals in UTC for the given user.

        Args:
            user_id: Internal user ID (used to look up stored credentials).
            start: Window start (timezone-aware UTC).
            end: Window end (timezone-aware UTC).

        Returns:
            List of busy (start, end) tuples, each timezone-aware UTC.
        """
        ...

    async def create_event(
        self,
        user_id: int,
        title: str,
        start: datetime,
        end: datetime,
        description: str = "",
        attendee_email: str | None = None,
        create_meet_link: bool = False,
    ) -> str:
        """Create a calendar event and return the provider-side event ID.

        Args:
            user_id: Internal user ID.
            title: Event title.
            start: Start time (timezone-aware UTC).
            end: End time (timezone-aware UTC).
            description: Event body / notes.
            attendee_email: Client email to invite as attendee.
            create_meet_link: If True, request a video conferencing link.

        Returns:
            Provider event ID (stored in bookings.google_event_id).
        """
        ...

    async def delete_event(self, user_id: int, event_id: str) -> None:
        """Delete a calendar event by provider event ID.

        Args:
            user_id: Internal user ID.
            event_id: Provider-side event ID returned by create_event.
        """
        ...

    async def get_meet_link(self, user_id: int, event_id: str) -> str | None:
        """Return the video conferencing link for an event, if any."""
        ...


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------


@runtime_checkable
class EmailProvider(Protocol):
    """Send transactional emails.

    Phase 1 implementation: SmtpEmailProvider
    Phase 2 implementations: PostmarkEmailProvider, MailgunEmailProvider
    """

    async def send_confirmation_to_client(
        self,
        booking_id: int,
        client_email: str,
        client_name: str,
        consultant_name: str,
        start: datetime,
        end: datetime,
        client_timezone: str,
        cancel_url: str,
        reschedule_url: str,
        video_link: str | None = None,
        ics_content: bytes | None = None,
    ) -> None:
        """Send booking confirmation to the client."""
        ...

    async def send_confirmation_to_consultant(
        self,
        booking_id: int,
        consultant_email: str,
        consultant_name: str,
        client_name: str,
        client_email: str,
        client_data: dict[str, Any],
        start: datetime,
        end: datetime,
        consultant_timezone: str,
        cancel_url: str,
        ics_content: bytes | None = None,
    ) -> None:
        """Send booking notification to the consultant."""
        ...

    async def send_reminder(
        self,
        booking_id: int,
        recipient_email: str,
        recipient_name: str,
        start: datetime,
        end: datetime,
        recipient_timezone: str,
        video_link: str | None = None,
    ) -> None:
        """Send a reminder email (24h or 1h before)."""
        ...

    async def send_cancellation(
        self,
        booking_id: int,
        recipient_email: str,
        recipient_name: str,
        start: datetime,
        end: datetime,
        recipient_timezone: str,
        cancelled_by: str = "system",
    ) -> None:
        """Send cancellation notice to one party."""
        ...

    async def send_poll_invite(
        self,
        poll_id: int,
        recipient_email: str,
        recipient_name: str,
        poll_title: str,
        poll_url: str,
        expires_at: datetime | None = None,
    ) -> None:
        """Send a group poll invitation."""
        ...

    async def send_poll_confirmation(
        self,
        poll_id: int,
        recipient_email: str,
        recipient_name: str,
        poll_title: str,
        start: datetime,
        end: datetime,
        recipient_timezone: str,
        ics_content: bytes | None = None,
    ) -> None:
        """Send poll winner confirmation to a participant."""
        ...


# ---------------------------------------------------------------------------
# Webhook (Phase 2 seam — defined here so Phase 1 code can reference it)
# ---------------------------------------------------------------------------


@runtime_checkable
class WebhookProvider(Protocol):
    """Outbound webhook dispatcher.

    Phase 1: NoopWebhookProvider (does nothing).
    Phase 2: HttpWebhookProvider (HMAC-signed POST with retry).
    """

    async def dispatch(
        self,
        event: str,
        payload: dict[str, Any],
    ) -> None:
        """Fire a webhook event.

        Args:
            event: Event name, e.g. "booking.created", "booking.cancelled".
            payload: JSON-serialisable event payload.
        """
        ...
