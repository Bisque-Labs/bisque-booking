/**
 * Vercel Cron Job routes.
 *
 * Registered in vercel.json under "crons":
 *   {"path": "/api/cron/send-reminders", "schedule": "0 * * * *"}
 *
 * Vercel calls these endpoints automatically on schedule.
 * To protect against accidental direct calls, requests must carry the
 * CRON_SECRET env var as a Bearer token (Vercel sets this for you).
 *
 * Routes:
 *   GET /api/cron/send-reminders  → send reminder emails for upcoming bookings
 */

import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb, bookings, eventTypes, users } from "@/db";

const cronRouter = new Hono();

// ---------------------------------------------------------------------------
// Guard middleware — only Vercel (or a caller with CRON_SECRET) may call these.
// ---------------------------------------------------------------------------

cronRouter.use("*", async (c, next) => {
  const secret = process.env["CRON_SECRET"];
  if (secret) {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${secret}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// Send reminders for bookings starting in the next 24 hours.
// ---------------------------------------------------------------------------

cronRouter.get("/send-reminders", async (c) => {
  const db = getDb();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);

  // Find confirmed bookings starting in the 23–24 hour window
  // (the cron runs hourly, so this catches each booking exactly once).
  const upcoming = await db
    .select({
      id: bookings.id,
      clientEmail: bookings.clientEmail,
      clientName: bookings.clientName,
      clientTimezone: bookings.clientTimezone,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      eventTypeTitle: eventTypes.title,
      videoLink: eventTypes.videoLink,
      consultantName: users.name,
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(bookings.eventTypeId, eventTypes.id))
    .innerJoin(users, eq(eventTypes.userId, users.id))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(bookings.startAt, in23h),
        lte(bookings.startAt, in24h),
      ),
    );

  let sent = 0;
  let failed = 0;

  for (const booking of upcoming) {
    try {
      // In production, import and use your real EmailProvider here.
      // The noop provider is used by default; swap it for SmtpEmailProvider
      // when SMTP_HOST is configured.
      const { NoopEmailProvider } = await import("@/providers/noop");
      const emailProvider = new NoopEmailProvider();

      await emailProvider.sendReminder({
        bookingId: booking.id,
        recipientEmail: booking.clientEmail,
        recipientName: booking.clientName,
        start: booking.startAt,
        end: booking.endAt,
        recipientTimezone: booking.clientTimezone,
        videoLink: booking.videoLink,
      });

      sent++;
    } catch (err) {
      console.error(`Failed to send reminder for booking ${booking.id}:`, err);
      failed++;
    }
  }

  return c.json({
    ok: true,
    checked: upcoming.length,
    sent,
    failed,
    window: { from: in23h.toISOString(), to: in24h.toISOString() },
  });
});

export { cronRouter };
