# bisque-booking

> Self-hosted scheduling for consulting teams — 1:1 booking links, group availability polls, and smart calendar sync in a single Docker Compose.

## Vision

bisque-booking is an open-source scheduling platform built for consulting teams who run their own infrastructure. It replaces Calendly, Doodle, and Acuity with a single self-hosted tool that handles both individual booking pages and multi-person availability coordination — without the per-seat SaaS pricing, data residency concerns, or dependency on a third-party service that can change its pricing or deprecate features on you.

This is opinionated software: it is designed for teams of 2–20, it assumes Google Workspace as the primary calendar and email provider (with Outlook as a secondary path), and it is built to be operated by a developer or technical admin who wants a system they fully control.

## Problem Statement

Existing scheduling tools fail consulting teams in predictable ways:

**Cal.com** is the closest open-source equivalent to Calendly, but self-hosting requires Node.js + PostgreSQL + Redis + background job workers, and the configuration surface area is enormous. The self-hosted version lags the cloud version. Enterprise features are being gated behind paid tiers. For a 5-person team that just wants booking links and Google Calendar sync, it is dramatically over-engineered.

**Rallly** handles group availability polls (the Doodle use case) cleanly and is easy to self-host, but it has no 1:1 booking links, no calendar sync, and no concept of a "team member" with a persistent scheduling profile.

**Easy!Appointments** is mature and handles service-provider booking well, but it is a PHP/MySQL LAMP-stack application from a different era. It has no modern API, no webhook support, and no path to integrations with tools like Airtable or a CRM.

**The unified gap:** No existing open-source tool handles both the "book a call with Sarah" (individual booking link) and the "find a time when Alice, Bob, and the client are all free" (group coordination) use cases in a single product with a single data model, single auth system, and single place to configure calendar connections.

Additional gaps that matter for a consulting team:

- **Timezone UX is an afterthought.** No tool proactively warns "this slot is 9:30pm for your client in London."
- **Routing is missing.** When a new client fills out an intake form, who gets the booking? None of the OSS tools have intake-to-consultant routing logic.
- **Email deliverability is DIY.** Every tool expects you to figure out SMTP config, SPF/DKIM, and transactional email on your own.
- **Single-server deployment is an afterthought.** The modern OSS tools assume cloud-native multi-service architectures.

## Target Users

**The Consultant (internal user)**

A member of the consulting team who needs a personal booking page at `booking.company.com/sarah`. She sets her availability rules (Mon–Thu, 9am–5pm Eastern, no Fridays), connects her Google Calendar so the system knows when she's actually free, and shares her link in email signatures and proposals. She needs to receive confirmation emails, be able to reschedule, and see her upcoming bookings in a dashboard. She is not technical — she should never need to touch a config file.

**The Client (external user, no account)**

A prospective or current client who receives a booking link. They see available slots in their own timezone (auto-detected), pick one, fill out a short intake form (name, company, what they want to discuss), and receive a confirmation email with a calendar invite attached. They may need to reschedule — they should be able to do so via a link in the confirmation email without creating an account. They are often on mobile. The experience must be fast, clean, and require zero account creation.

**The Admin (internal, technical)**

The person who deploys and maintains bisque-booking. They configure the Docker Compose environment, set up SMTP or a transactional email provider, connect Google OAuth credentials, manage team member accounts, configure routing rules, and monitor the system. They want a straightforward ops story: one `docker compose up`, a handful of environment variables, and a system that runs without babysitting.

---

## Features

### Core Features (MVP)

**1. Team Member Booking Pages**

Each team member gets a personal booking URL: `booking.company.com/[slug]`. The slug is set during account creation.

- Consultant configures their availability windows (day-of-week + time ranges, per timezone)
- Consultant sets buffer time between meetings (e.g., 15 min after every call)
- Consultant sets minimum advance notice (e.g., "no same-day bookings")
- Consultant sets maximum booking horizon (e.g., "only 30 days out")
- Multiple event types per consultant: "30-min intro call," "90-min strategy session," each with its own duration, description, and intake questions
- Booking page is public by default; can be set to require a password or link-only (no indexed public listing)

**2. Google Calendar Sync (Read + Write)**

- Consultant connects their Google Calendar via OAuth
- System reads busy/free status in real-time when a client loads the booking page — slots are only shown if the calendar is actually free
- When a booking is confirmed, the system creates a Google Calendar event on the consultant's calendar with the client details in the description
- Calendar event includes a video conferencing link (Google Meet, generated via Calendar API, or a static Zoom/Meet URL the consultant provides)
- Sync is pull-based on page load (no polling daemon required for MVP); webhooks for real-time updates in Phase 2

**3. Client Booking Flow**

The client-facing booking flow is the core UX surface. It must be mobile-first, fast, and require no account.

1. Client opens booking link
2. Page loads available dates (month view) — grayed-out dates have no availability
3. Client selects a date; available time slots appear
4. **Timezone detection:** System detects client's local timezone via browser API. Displays times in client's timezone. Shows a subtle indicator: "Displaying times in America/Chicago. Your consultant is in America/New_York."
5. **Timezone warning:** If a selected slot is before 8am or after 7pm in either party's timezone, show a soft warning: "Note: this is 8:30pm for Sarah in New York."
6. Client selects a slot
7. Intake form: Name, email, company (optional), and any custom questions the consultant configured for this event type
8. Client submits → confirmation screen with event details + "Add to Google Calendar" / "Add to Apple Calendar" / ICS download links
9. Confirmation email sent to client (with ICS attachment and calendar event links)
10. Notification email sent to consultant

**4. Email Confirmations and Reminders**

- Confirmation email to client immediately on booking: includes date/time in client's timezone, video link, consultant name, and a cancellation/reschedule link
- Confirmation email to consultant: includes client name, company, intake form answers, and a cancellation link
- Reminder email to client: 24 hours before, then 1 hour before (configurable per event type)
- Reminder email to consultant: 1 hour before
- All emails include an ICS file attachment compatible with Google Calendar, Outlook, and Apple Calendar
- Cancellation: either party can cancel via link in confirmation email; both receive cancellation notices
- Rescheduling: client can click "reschedule" link → returns to booking page with the same event type pre-selected, existing booking pre-cancelled

**5. Group Availability Polls**

For the "find a time for a multi-person kickoff" use case. This is a distinct flow from 1:1 booking links.

- Internal user creates a poll: title, description, proposed time slots (manual or auto-suggested from calendar free/busy)
- Shareable poll link sent to participants (internal team members and/or external clients)
- Each participant marks slots as "Yes," "If needed," or "No" — no account required for external participants
- Admin/creator sees a summary grid: which slots have the most "Yes" votes
- Creator selects a winning slot → system creates calendar events for all internal participants who connected Google Calendar, sends confirmation emails to all participants
- Polls have an expiry (default 7 days); creator can extend or close early

**6. Admin Dashboard**

- User management: create/deactivate team member accounts, set roles (admin vs. consultant)
- View all upcoming bookings across the team
- View all active availability polls
- System health: SMTP connection status, Google OAuth token status per user
- Basic analytics: bookings per consultant per week, cancellation rate, average time-to-book

**7. Authentication**

- Team members log in via Google OAuth (primary) — this also establishes the calendar connection
- Email/password login as a fallback (for consultants not on Google Workspace)
- Sessions are JWT-based; token refresh handled transparently
- No client accounts — clients interact only via tokenized links (booking link, cancellation link, reschedule link)
- Admin role is set in the database; first registered user is auto-promoted to admin

---

### Phase 2 Features

**Real-time Calendar Webhooks**

Replace the pull-on-load calendar sync with Google Calendar push notifications. When a consultant's calendar changes (new event added, event deleted), bisque-booking receives a webhook and invalidates its availability cache. This prevents double-bookings in high-traffic scenarios and keeps the booking page availability accurate in real-time.

**Outlook / Microsoft 365 Calendar Sync**

Support Microsoft OAuth and the Microsoft Graph API for calendar read/write, mirroring the Google Calendar integration. Consultant connects via "Sign in with Microsoft" and the same availability and event creation logic applies.

**Round-Robin Team Booking**

A shared booking link (e.g., `booking.company.com/team/intro-call`) that routes incoming bookings to the next available consultant using a round-robin or load-balanced algorithm. Admin configures which consultants are in the pool and the algorithm. Useful for sales or support intake flows.

**Intake Form Routing Rules**

Admin configures routing rules: "if the client selects 'Enterprise' in the company size field, route to Sarah; otherwise round-robin." Rules are evaluated in order; first match wins. This replaces the need for multiple separate booking links for different client segments.

**Webhook Outbound Integration**

When a booking is created, cancelled, or rescheduled, bisque-booking sends a POST to a configurable webhook URL. Payload includes all booking details in JSON. This enables integration with Zapier, Make, n8n, or a custom backend without polling the database.

**Airtable Sync**

Write new bookings to an Airtable base automatically. Field mapping is configurable in the admin dashboard. Useful for teams that manage their CRM or project intake in Airtable. Implemented as a webhook consumer (uses the outbound webhook system above plus a built-in Airtable adapter).

**Bisque CRM (Kissinger) Integration**

When a booking is created for a new client (email not seen before), optionally create or update a contact in the Kissinger CRM. Configurable: on/off per event type. Sends the client's name, company, and intake form answers. Implemented via Kissinger's API or direct database write if co-deployed.

**Embeddable Booking Widget**

A JavaScript snippet that can be embedded on any website (e.g., `booking.company.com/embed/sarah`) and renders the booking flow in an iframe or modal. Supports `data-event-type` attribute to pre-select an event type. Useful for embedding a "Book a call" button on a marketing site.

---

### Phase 3 / AI Features

**AI-Assisted Time Suggestions for Group Polls**

When creating a group availability poll, the admin can click "Suggest slots." The system reads the connected calendars of all internal participants, identifies free windows that overlap across the group, scores them by time-of-day quality (avoiding early mornings and late evenings in all participants' timezones), and pre-populates the poll with the top 5–8 suggestions. The admin can add, remove, or edit before sending.

**Smart Timezone Conflict Detection**

Beyond the soft warning at booking time, AI-layer analysis of historical booking patterns: "Your clients in Europe typically cancel morning calls. Consider not showing slots before 10am CET." Surfaced as a recommendation in the consultant's settings dashboard, not an automatic change.

**Meeting Prep Briefs**

Fifteen minutes before each confirmed meeting, generate and email the consultant a one-page brief: the client's name, company, what they said in the intake form, any previous bookings with this client, and (if Kissinger integration is enabled) recent CRM notes. Generated via the configured LLM API key (OpenAI or Anthropic, configurable).

**Natural Language Availability Configuration**

Consultant can type "I'm available Tuesday and Thursday afternoons, never before 9am, and I need at least 30 minutes between calls" and the system parses this into structured availability rules using an LLM. The parsed rules are shown for confirmation before saving. Reduces friction for non-technical team members.

---

## Technical Architecture

**Runtime: Python + FastAPI**

Python is chosen for its ecosystem depth in scheduling, timezone handling (`pytz`, `dateutil`), Google API clients, and LLM integrations. FastAPI provides async HTTP with automatic OpenAPI docs. This is not a Next.js application — the frontend complexity does not justify a full React framework.

**Frontend: HTMX + Jinja2 templates (server-side rendering)**

The booking page and admin dashboard are server-rendered HTML enhanced with HTMX for partial-page updates (slot selection, form submission). No React, no build step, no JavaScript bundler required. This makes the Docker image small and the ops story simple. Progressive enhancement: the booking flow works with JavaScript disabled.

**Database: PostgreSQL**

Single PostgreSQL instance. Schema managed with Alembic migrations. No Redis required for MVP (availability is computed on request; no caching layer needed at consulting-team scale). Background jobs (email sending, reminder scheduling) use APScheduler running in-process.

**Data Model (core entities):**

```
users               — team members (id, email, name, slug, role, google_credentials_encrypted, timezone)
event_types         — booking page configurations (id, user_id, title, duration_minutes, description, intake_questions JSON, buffer_minutes, min_notice_hours, max_horizon_days, color)
availability_rules  — when a user is available (id, user_id, day_of_week, start_time, end_time, timezone)
bookings            — confirmed bookings (id, event_type_id, client_email, client_name, client_data JSON, start_at, end_at, status, google_event_id, cancel_token, reschedule_token)
availability_polls  — group polls (id, creator_id, title, description, expires_at, status)
poll_slots          — proposed slots in a poll (id, poll_id, start_at, end_at)
poll_responses      — participant answers (id, poll_id, participant_email, participant_name, responses JSON)
```

**Email: SMTP with pluggable provider support**

Emails sent via SMTP. Environment variables configure the SMTP host, port, username, password, and From address. Works with Gmail (app password), Google Workspace SMTP relay, Postmark, Mailgun, or any standard SMTP provider. HTML email templates are Jinja2, stored in `templates/email/`. The admin dashboard shows the last 10 email send attempts and their status.

**Auth: Google OAuth 2.0 + session cookies**

Google OAuth handles both login and calendar permission grant in a single flow (scopes: `openid email profile https://www.googleapis.com/auth/calendar`). OAuth tokens stored encrypted in the database (Fernet symmetric encryption; key from environment variable). Session cookies are signed with a server-side secret. Email/password login uses bcrypt hashing.

**Deployment: Single Docker Compose**

Two services: `app` (FastAPI) and `db` (PostgreSQL). Optional third service: `smtp` (Mailpit for local development email testing). Production adds a reverse proxy (nginx or Caddy) in front but that is outside the Compose file and documented separately.

---

## Self-Hosting Requirements

**Minimum server:** 1 CPU, 512MB RAM, 10GB disk. Tested on a $6/month VPS.

**Docker Compose spec (production):**

```yaml
services:
  app:
    image: ghcr.io/bisque-labs/bisque-booking:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://bisque:${DB_PASSWORD}@db:5432/bisque_booking
      SECRET_KEY: ${SECRET_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USERNAME: ${SMTP_USERNAME}
      SMTP_PASSWORD: ${SMTP_PASSWORD}
      FROM_EMAIL: ${FROM_EMAIL}
      BASE_URL: ${BASE_URL}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: bisque_booking
      POSTGRES_USER: bisque
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bisque"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Required environment variables:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | Random 32-byte hex string for session signing |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console OAuth credentials |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console OAuth credentials |
| `ENCRYPTION_KEY` | Fernet key for encrypting stored OAuth tokens (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (typically 587 for STARTTLS) |
| `SMTP_USERNAME` | SMTP auth username |
| `SMTP_PASSWORD` | SMTP auth password or app password |
| `FROM_EMAIL` | The "From" address for outgoing mail |
| `BASE_URL` | Public URL of the deployment (e.g., `https://booking.company.com`) |

**Google Cloud Console setup (documented in `docs/google-setup.md`):**

1. Create a project in Google Cloud Console
2. Enable Google Calendar API and Google People API
3. Create OAuth 2.0 credentials (Web Application type)
4. Add `{BASE_URL}/auth/google/callback` as an authorized redirect URI
5. Add all team member Google accounts as test users (while in development/testing mode) or publish the OAuth app

**First-run bootstrap:**

On first startup, if no users exist in the database, the app serves a setup wizard at `BASE_URL/setup` that creates the first admin account. This route is disabled once any user exists.

---

## Integrations

**Google Calendar (Core)**
- Auth via OAuth 2.0 with `https://www.googleapis.com/auth/calendar` scope
- Read: `freebusy.query` for availability computation
- Write: `events.insert` on booking confirmation, `events.delete` on cancellation
- Optional: `events.watch` for push notifications (Phase 2)

**Google Meet**
- Generated via Calendar API when creating events with `conferenceData.createRequest`
- Requires `calendar` scope; no separate Google Meet API needed

**SMTP / Transactional Email**
- Standard SMTP via Python `smtplib` with STARTTLS
- Compatible with: Gmail app passwords, Google Workspace SMTP relay, Postmark, Mailgun, SendGrid, AWS SES, self-hosted Postfix
- HTML email templates with plain-text fallbacks
- ICS attachments generated with Python `icalendar` library

**Outlook / Microsoft 365 (Phase 2)**
- Auth via Microsoft Identity Platform (MSAL)
- Scope: `Calendars.ReadWrite`
- Read/write via Microsoft Graph API (`/me/calendarView`, `/me/events`)

**Outbound Webhooks (Phase 2)**
- POST on booking events: `booking.created`, `booking.cancelled`, `booking.rescheduled`, `poll.closed`
- Signed with HMAC-SHA256 using a configurable secret
- Retry logic: 3 attempts with exponential backoff

**Airtable (Phase 2)**
- Uses Airtable REST API with personal access token
- Field mapping configured in admin dashboard (JSON key → Airtable field name)
- Triggered by webhook consumer on `booking.created` event

**Bisque CRM / Kissinger (Phase 2)**
- Checks if client email exists in Kissinger contact graph
- Creates or updates contact record on booking confirmation
- Logs the booking as an interaction in the CRM timeline
- Config: Kissinger API endpoint + auth token in environment variables

**Zapier / Make / n8n**
- Via outbound webhooks — no native app required
- Document the webhook payload schema so users can build their own automations

---

## Requirements & Validation Criteria

| Feature | Acceptance Criteria |
|---|---|
| **Personal booking page** | Consultant can access `{BASE_URL}/{slug}` and see their available slots. Page loads in < 2 seconds on a cold request (no calendar cache). |
| **Google Calendar integration** | After connecting Google Calendar, blocked times on the consultant's calendar do not appear as available slots on the booking page. Newly created blocks appear unavailable within 30 seconds of page reload. |
| **Slot booking — client flow** | Client can complete a booking (select slot, fill form, submit) in under 60 seconds on a mobile device. No JavaScript required for core flow. Timezone is auto-detected and displayed correctly. |
| **Timezone warnings** | If a selected slot falls outside 8am–7pm in either party's timezone, a visible warning is shown before the client confirms. |
| **Confirmation emails** | Client receives confirmation email within 30 seconds of booking. Email contains correct time in client's timezone, ICS attachment, video link, and reschedule/cancel links. |
| **Reminders** | Reminder emails are sent at 24h and 1h before the meeting. Timing is accurate within ±2 minutes. |
| **Rescheduling** | Client can click reschedule link in confirmation email, select a new slot, and receive an updated confirmation. The old calendar event is deleted; a new one is created. |
| **Cancellation** | Either party can cancel via link. Both receive cancellation emails. Google Calendar event is deleted. Slot becomes available again on the booking page. |
| **Group availability poll** | Admin can create a poll with 5+ proposed slots, share it, collect responses from external participants without requiring them to create accounts, and confirm a winning slot that creates calendar events for internal participants. |
| **Admin dashboard** | Admin can view all upcoming bookings across the team, create/deactivate user accounts, and see SMTP and Google OAuth health status. |
| **Email deliverability** | System can send email via at minimum: Gmail app password SMTP, Google Workspace SMTP relay, and Postmark. SMTP connection tested on save in admin dashboard. |
| **Self-hosting** | Running `docker compose up` with correct environment variables produces a working system. Time from clone to first booking: < 30 minutes for a developer. |
| **Mobile client experience** | Booking flow is usable on iOS Safari and Android Chrome without horizontal scrolling. Touch targets are >= 44px. |
| **Security** | Google OAuth tokens are encrypted at rest. Session tokens are signed and have a 24-hour expiry. Cancellation/reschedule tokens are single-use. No client-facing route reveals another client's booking details. |
| **Scale** | System handles 100 concurrent booking page loads without degradation on a 1 CPU / 512MB server. (Consulting-team scale, not SaaS scale.) |

---

## Non-Goals (explicitly out of scope)

- Payment collection or deposits (use Stripe directly if needed)
- SMS reminders (email only in MVP; Phase 2 may add via Twilio)
- Multi-tenant SaaS mode (this is single-org self-hosted software)
- Native mobile apps (mobile-optimized web is sufficient)
- Video conferencing hosting (we link to Google Meet or a static URL; we don't host video)
- HIPAA / SOC 2 compliance certification (though the architecture doesn't preclude it)

---

*bisque-booking is built by [Bisque Labs](https://github.com/Bisque-Labs) for consulting teams who believe their scheduling infrastructure should be as controllable as their code.*
