# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

All application code lives in the `nextjs/` directory.

```bash
cd nextjs
npm install
npm test           # Run all tests with Vitest
npm run dev        # Local dev server (http://localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
```

## Architecture Overview

bisque-booking is a **standalone Next.js 14 app** (App Router + TypeScript + Tailwind CSS).
It is NOT part of eloso-bisque. It deploys independently.

```
nextjs/
  app/
    page.tsx                      # Landing page
    book/page.tsx                 # Public booking page (unauthenticated)
    admin/                        # Admin UI (password-protected)
      login/page.tsx
      page.tsx                    # Admin dashboard
      bookings/                   # Booking list + actions (BIS-664)
      settings/                   # Availability config (BIS-660)
    api/
      booking/
        route.ts                  # POST /api/booking, GET /api/booking
        slots/route.ts            # GET /api/booking/slots?date=&tz=
        [id]/route.ts             # GET/PATCH/DELETE /api/booking/:id
        cron/reminders/route.ts   # Vercel Cron (BIS-667)
      admin/auth/login/route.ts   # Admin password auth
  lib/
    db/
      index.ts                    # better-sqlite3 singleton
      migrate.ts                  # DDL migrations (auto-run on startup)
      schema.ts                   # TypeScript types
    slots/
      engine.ts                   # Slot generation logic
    adapters/
      index.ts                    # Adapter registry (emitBookingConfirmed etc.)
      kissinger.ts                # Optional Kissinger CRM adapter (BIS-666)
  middleware.ts                   # JWT-based admin auth guard
  vercel.json                     # Vercel Cron config
  .env.example                    # Environment variable reference
  __tests__/                      # Vitest tests
```

### Key env vars

| Var | Required | Description |
|-----|----------|-------------|
| `ADMIN_PASSWORD` | Yes | Password for /admin login |
| `SESSION_SECRET` | Yes | JWT signing key (32+ chars) |
| `KISSINGER_GRAPHQL_URL` | No | Enable Kissinger CRM sync |
| `DATABASE_PATH` | No | SQLite file path (default: ./data/bookings.db) |
| `CRON_SECRET` | No | Authenticates /api/booking/cron/reminders |

### Kissinger integration seam

The booking core emits events via `lib/adapters/index.ts`. The Kissinger adapter
(`lib/adapters/kissinger.ts`) is registered only when `KISSINGER_GRAPHQL_URL` is set.
No Kissinger code is imported by the booking core. This seam can support future
adapters (Notion, HubSpot, etc.) without modifying core.

## Conventions & Patterns

- All times stored as UTC ISO-8601; displayed in visitor/host timezone via `Intl` APIs
- SQLite via `better-sqlite3` (synchronous, zero-infra); switchable to Postgres via `DATABASE_URL`
- Admin auth: HTTP-only JWT cookie, verified in `middleware.ts`
- Adapter pattern: `registerBookingAdapter()` at startup; core emits events, adapters listen
- Tests use in-memory SQLite (`:memory:`), never touch real DB
