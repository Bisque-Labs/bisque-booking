# bisque-booking (Next.js app)

Self-hosted scheduling for consulting teams — 1:1 booking links, Google Calendar sync, and reminders.

## Tech Stack

- **Language:** TypeScript (no Python anywhere in this project)
- **Runtime:** Node.js
- **Framework:** Next.js 14 App Router
- **Database:** SQLite via `better-sqlite3`
- **Styling:** Tailwind CSS
- **Tests:** Vitest

## Getting Started

```bash
npm install
cp .env.example .env.local
# Edit .env.local — set ADMIN_PASSWORD and SESSION_SECRET at minimum
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the public booking page.
Open [http://localhost:3000/admin](http://localhost:3000/admin) — the admin dashboard.

## Available Scripts

```bash
npm run dev         # Local dev server (http://localhost:3000)
npm run build       # Production build
npm run start       # Run production build
npm run lint        # ESLint
npm test            # Run all tests with Vitest
npm run test:coverage  # Run tests with coverage report
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_PASSWORD` | Yes | Password for /admin login |
| `SESSION_SECRET` | Yes | JWT signing key (32+ chars) |
| `DATABASE_PATH` | No | SQLite file path (default: `./data/bookings.db`) |
| `CRON_SECRET` | No | Bearer token for `/api/cron/reminders` |
| `RESEND_API_KEY` | No | Enable Resend email provider |
| `SMTP_HOST` | No | Enable SMTP email provider |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `EMAIL_FROM` | No | From address for outgoing emails |
| `BASE_URL` | No | Public URL (default: `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (enables Calendar sync) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `KISSINGER_GRAPHQL_URL` | No | Kissinger CRM endpoint (enables CRM sync) |

## Architecture

All code lives in `nextjs/`. This is a standalone Next.js 14 app — it is **not** part of a larger Python/FastAPI service. There is no Python, no FastAPI, no alembic, and no PostgreSQL in this application. It uses SQLite exclusively.

```
app/
  page.tsx                       # Landing page
  book/page.tsx                  # Public booking page
  confirm/[id]/page.tsx          # Booking confirmation page
  reschedule/[token]/page.tsx    # Public reschedule flow
  admin/
    page.tsx                     # Admin dashboard
    bookings/page.tsx            # All bookings list
    availability/page.tsx        # Availability config
    login/page.tsx
  api/
    bookings/route.ts            # POST/GET bookings
    bookings/[id]/route.ts       # GET/PATCH single booking
    bookings/[id]/cancel/route.ts
    bookings/[id]/reschedule/route.ts
    slots/route.ts               # GET available slots
    admin/
      availability/route.ts
      blocked-dates/route.ts
      auth/login/route.ts
    auth/
      google/route.ts
      google/callback/route.ts
    cron/
      reminders/route.ts
lib/
  db/index.ts                    # better-sqlite3 singleton
  db/migrate.ts                  # DDL migrations
  db/schema.ts                   # TypeScript types
  slots/engine.ts                # Slot generation algorithm
  email/index.ts                 # Email adapter (Resend + SMTP)
  adapters/index.ts              # Adapter registry
  adapters/kissinger.ts          # Kissinger CRM adapter
middleware.ts                    # JWT admin auth guard
vercel.json                      # Vercel Cron config
```

## Deployment

Deploy to Vercel with `vercel deploy`. Set environment variables in the Vercel dashboard.
SQLite data persists in the `data/` directory — configure persistent storage or use `DATABASE_PATH` to point to a mounted volume.
