"""No-op provider implementations used in tests and local dev without credentials."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class NoopCalendarProvider:
    """Returns empty busy intervals; logs create/delete calls."""

    async def get_free_busy(self, user_id: int, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
        logger.debug("NoopCalendarProvider.get_free_busy user=%s %s–%s", user_id, start, end)
        return []

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
        event_id = f"noop-{user_id}-{int(start.timestamp())}"
        logger.info("NoopCalendarProvider.create_event id=%s title=%r", event_id, title)
        return event_id

    async def delete_event(self, user_id: int, event_id: str) -> None:
        logger.info("NoopCalendarProvider.delete_event id=%s", event_id)

    async def get_meet_link(self, user_id: int, event_id: str) -> str | None:
        return None


class NoopEmailProvider:
    """Logs email calls; does not send anything."""

    async def send_confirmation_to_client(self, booking_id: int, client_email: str, client_name: str,
                                          consultant_name: str, start: datetime, end: datetime,
                                          client_timezone: str, cancel_url: str, reschedule_url: str,
                                          video_link: str | None = None, ics_content: bytes | None = None) -> None:
        logger.info("NoopEmail: confirmation → %s (booking %s)", client_email, booking_id)

    async def send_confirmation_to_consultant(self, booking_id: int, consultant_email: str, consultant_name: str,
                                              client_name: str, client_email: str, client_data: dict[str, Any],
                                              start: datetime, end: datetime, consultant_timezone: str,
                                              cancel_url: str, ics_content: bytes | None = None) -> None:
        logger.info("NoopEmail: consultant notification → %s (booking %s)", consultant_email, booking_id)

    async def send_reminder(self, booking_id: int, recipient_email: str, recipient_name: str, start: datetime,
                            end: datetime, recipient_timezone: str, video_link: str | None = None) -> None:
        logger.info("NoopEmail: reminder → %s (booking %s)", recipient_email, booking_id)

    async def send_cancellation(self, booking_id: int, recipient_email: str, recipient_name: str, start: datetime,
                                end: datetime, recipient_timezone: str, cancelled_by: str = "system") -> None:
        logger.info("NoopEmail: cancellation → %s (booking %s)", recipient_email, booking_id)

    async def send_poll_invite(self, poll_id: int, recipient_email: str, recipient_name: str, poll_title: str,
                               poll_url: str, expires_at: datetime | None = None) -> None:
        logger.info("NoopEmail: poll invite → %s (poll %s)", recipient_email, poll_id)

    async def send_poll_confirmation(self, poll_id: int, recipient_email: str, recipient_name: str, poll_title: str,
                                     start: datetime, end: datetime, recipient_timezone: str,
                                     ics_content: bytes | None = None) -> None:
        logger.info("NoopEmail: poll confirmation → %s (poll %s)", recipient_email, poll_id)


class NoopWebhookProvider:
    """Phase 2 placeholder — does nothing."""

    async def dispatch(self, event: str, payload: dict[str, Any]) -> None:
        logger.debug("NoopWebhook: event=%s", event)
