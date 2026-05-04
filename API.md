# bisque-booking API Reference

## Overview

bisque-booking exposes two kinds of API surfaces:

1. **HTTP REST API** — consumed by the HTMX frontend and external integrations
2. **Provider Protocols** — Python interfaces that external systems (Google Calendar, Outlook, SMTP, webhooks) implement

The FastAPI app auto-generates OpenAPI docs at `/api/docs` (Swagger UI) and `/api/redoc` (ReDoc).

---

## Provider Protocols

These are the **clean seams** between bisque-booking's core logic and external systems. All integration code implements one of these protocols. Core logic never imports a concrete provider directly — it only depends on the protocol type.

See `app/services/protocols.py` for the full typed interface definitions.

### CalendarProvider

```python
class CalendarProvider(Protocol):
    async def get_free_busy(user_id, start, end) -> list[tuple[datetime, datetime]]
    async def create_event(user_id, title, start, end, description, attendee_email, create_meet_link) -> str
    async def delete_event(user_id, event_id) -> None
    async def get_meet_link(user_id, event_id) -> str | None
```

**Phase 1 implementation:** `app/services/google_calendar.py` — GoogleCalendarProvider

**Phase 2 additions:**
- `app/services/outlook_calendar.py` — OutlookCalendarProvider (Microsoft Graph)
- `app/services/mock_calendar.py` — deterministic test double

**Dependency injection:** `app/dependencies.py:get_calendar_provider()`

---

### EmailProvider

```python
class EmailProvider(Protocol):
    async def send_confirmation_to_client(booking_id, client_email, ...) -> None
    async def send_confirmation_to_consultant(booking_id, consultant_email, ...) -> None
    async def send_reminder(booking_id, recipient_email, ...) -> None
    async def send_cancellation(booking_id, recipient_email, ...) -> None
    async def send_poll_invite(poll_id, recipient_email, ...) -> None
    async def send_poll_confirmation(poll_id, recipient_email, ...) -> None
```

**Phase 1 implementation:** `app/services/smtp_email.py` — SmtpEmailProvider

**Phase 2 additions:** PostmarkEmailProvider, MailgunEmailProvider

**Dependency injection:** `app/dependencies.py:get_email_provider()`

---

### WebhookProvider

```python
class WebhookProvider(Protocol):
    async def dispatch(event: str, payload: dict) -> None
```

**Phase 1 implementation:** `app/services/noop_providers.py` — NoopWebhookProvider (does nothing)

**Phase 2 implementation:** HttpWebhookProvider — HMAC-SHA256 signed POST with retry

**Events dispatched:**
- `booking.created` — when a booking is confirmed
- `booking.cancelled` — when a booking is cancelled
- `booking.rescheduled` — when a booking is rescheduled
- `poll.closed` — when a poll winner is confirmed

**Payload schema (booking.created):**
```json
{
  "booking_id": 42,
  "client_email": "client@example.com",
  "start_at": "2025-03-15T14:00:00+00:00",
  "end_at": "2025-03-15T14:30:00+00:00",
  "event_type": "30-min-call",
  "consultant_slug": "sarah"
}
```

---

## HTTP Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic liveness check |
| GET | `/health/db` | Database connectivity check |

---

### Auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | Google OAuth callback |
| POST | `/auth/login` | Email/password login → sets session cookie |
| POST | `/auth/register` | Register first user or (admin-only) create team member |
| POST | `/auth/logout` | Clear session cookie |
| GET | `/auth/me` | Return current user info (requires auth) |

**Login request:**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Session:** HTTP-only cookie `session` containing a signed JWT (24-hour expiry).

---

### Booking Pages (public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/{slug}` | Consultant's public booking page |
| GET | `/{slug}/{event_type_slug}/slots` | Available slots for a date |
| POST | `/{slug}/{event_type_slug}/book` | Submit a booking |
| GET | `/bookings/{token}/cancel` | Cancel a booking (tokenized) |
| GET | `/bookings/{token}/reschedule` | Start reschedule flow (tokenized) |

**Slots query params:**
- `target_date` — ISO date string (YYYY-MM-DD), required
- `client_timezone` — IANA timezone string, default `UTC`

**Slots response:**
```json
{
  "date": "2025-03-15",
  "slots": [
    {
      "utc": "2025-03-15T14:00:00+00:00",
      "local": "10:00 AM",
      "warning": null
    }
  ]
}
```

**Booking request:**
```json
{
  "slot_utc": "2025-03-15T14:00:00+00:00",
  "client_name": "John Client",
  "client_email": "john@example.com",
  "client_timezone": "America/Chicago",
  "intake_answers": {
    "What would you like to discuss?": "Q1 roadmap"
  }
}
```

**Booking response:**
```json
{
  "booking_id": 42,
  "start_at": "2025-03-15T14:00:00+00:00",
  "end_at": "2025-03-15T14:30:00+00:00",
  "cancel_url": "https://booking.example.com/bookings/abc123/cancel",
  "reschedule_url": "https://booking.example.com/bookings/def456/reschedule"
}
```

---

### Dashboard (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | Consultant's dashboard (HTML) |
| GET | `/dashboard/availability` | Get availability rules |
| POST | `/dashboard/availability` | Replace all availability rules |
| POST | `/dashboard/event-types` | Create an event type |
| PUT | `/dashboard/event-types/{id}` | Update an event type |
| DELETE | `/dashboard/event-types/{id}` | Delete an event type |

**Availability rule format:**
```json
[
  { "day_of_week": 0, "start_time": "09:00", "end_time": "17:00", "timezone": "America/New_York" },
  { "day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "timezone": "America/New_York" }
]
```

Day of week: 0=Monday, 1=Tuesday, … 6=Sunday.

---

### Admin (requires admin role)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/admin` | Admin dashboard (HTML) |
| POST | `/dashboard/admin/users` | Create team member |
| PUT | `/dashboard/admin/users/{id}/deactivate` | Deactivate user |
| GET | `/dashboard/admin/stats` | Booking statistics |

---

### Polls

| Method | Path | Description |
|--------|------|-------------|
| GET | `/polls` | List current user's polls (authenticated) |
| POST | `/polls` | Create a poll (authenticated) |
| GET | `/polls/{share_token}` | View poll (public, HTML) |
| POST | `/polls/{share_token}/respond` | Submit availability response (public) |
| POST | `/polls/{share_token}/confirm/{slot_id}` | Confirm winning slot (creator only) |

**Poll create request:**
```json
{
  "title": "Q1 Kickoff Meeting",
  "description": "Finding a time for the whole team",
  "slots": [
    { "start_at": "2025-03-10T14:00:00Z", "end_at": "2025-03-10T15:00:00Z" },
    { "start_at": "2025-03-11T10:00:00Z", "end_at": "2025-03-11T11:00:00Z" }
  ],
  "expires_at": "2025-03-08T23:59:59Z"
}
```

**Poll response submission:**
```json
{
  "participant_name": "Alice",
  "participant_email": "alice@example.com",
  "responses": {
    "1": "yes",
    "2": "if_needed"
  }
}
```

---

## Data Model Summary

```
users               id, email, name, slug, role, timezone, google_id, google_credentials_encrypted
event_types         id, user_id, slug, title, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days, intake_questions
availability_rules  id, user_id, day_of_week, start_time, end_time, timezone
bookings            id, event_type_id, client_email, client_name, client_timezone, client_data, start_at, end_at, status, cancel_token, reschedule_token, google_event_id
availability_polls  id, creator_id, title, description, status, share_token, expires_at, confirmed_slot_id
poll_slots          id, poll_id, start_at, end_at
poll_responses      id, poll_id, participant_email, participant_name, responses (JSONB)
```

---

## Adding a New Integration (Phase 2 guide)

1. Implement the relevant protocol in `app/services/<provider>_<type>.py`
2. Add it to `app/dependencies.py:get_<type>_provider()` with appropriate feature detection
3. Add integration tests to `tests/test_<provider>_<type>.py` using a mock or sandbox
4. Document the new provider's configuration in `.env.example`

No changes to core business logic (routers, availability computation) should be needed.
