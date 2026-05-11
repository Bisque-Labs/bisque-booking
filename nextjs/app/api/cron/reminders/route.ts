/**
 * POST /api/cron/reminders
 *
 * Sends 24h and 1h reminder emails for upcoming bookings.
 * Called by Vercel Cron every 15 minutes.
 *
 * Idempotent: uses remind_24h_sent / remind_1h_sent flags to prevent duplicate sends.
 * Windows:
 *   24h — bookings starting between now+23h45m and now+24h15m
 *   1h  — bookings starting between now+45m and now+75m
 *
 * Auth: requires Authorization: Bearer <CRON_SECRET> header (when CRON_SECRET is set).
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendReminderEmail } from "@/lib/email";
import type { Booking, BookingConfig } from "@/lib/db/schema";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = getDb();
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;

  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const now = Date.now();

  const sent24h: string[] = [];
  const sent1h: string[] = [];

  // 24h window: now+23h45m to now+24h15m
  const window24hStart = new Date(now + (23 * 60 + 45) * 60 * 1000).toISOString();
  const window24hEnd = new Date(now + (24 * 60 + 15) * 60 * 1000).toISOString();

  const due24h = db
    .prepare(
      `SELECT * FROM bookings
       WHERE remind_24h_sent = 0
         AND status = 'confirmed'
         AND start_utc >= ?
         AND start_utc <= ?`
    )
    .all(window24hStart, window24hEnd) as Booking[];

  for (const booking of due24h) {
    try {
      await sendReminderEmail(
        {
          bookingId: booking.id,
          contactName: booking.contact_name,
          contactEmail: booking.contact_email,
          startUtc: booking.start_utc,
          endUtc: booking.end_utc,
          timezone: booking.timezone,
          notes: booking.notes,
          cancelToken: booking.cancel_token,
          rescheduleToken: booking.reschedule_token,
          adminName: config?.admin_name ?? "Host",
          adminEmail: config?.admin_email ?? "",
          baseUrl,
        },
        "24h"
      );
      db.prepare("UPDATE bookings SET remind_24h_sent = 1 WHERE id = ?").run(booking.id);
      sent24h.push(booking.id);
    } catch (err) {
      console.error("[cron:reminders] 24h reminder failed for", booking.id, err);
    }
  }

  // 1h window: now+45m to now+75m
  const window1hStart = new Date(now + 45 * 60 * 1000).toISOString();
  const window1hEnd = new Date(now + 75 * 60 * 1000).toISOString();

  const due1h = db
    .prepare(
      `SELECT * FROM bookings
       WHERE remind_1h_sent = 0
         AND status = 'confirmed'
         AND start_utc >= ?
         AND start_utc <= ?`
    )
    .all(window1hStart, window1hEnd) as Booking[];

  for (const booking of due1h) {
    try {
      await sendReminderEmail(
        {
          bookingId: booking.id,
          contactName: booking.contact_name,
          contactEmail: booking.contact_email,
          startUtc: booking.start_utc,
          endUtc: booking.end_utc,
          timezone: booking.timezone,
          notes: booking.notes,
          cancelToken: booking.cancel_token,
          rescheduleToken: booking.reschedule_token,
          adminName: config?.admin_name ?? "Host",
          adminEmail: config?.admin_email ?? "",
          baseUrl,
        },
        "1h"
      );
      db.prepare("UPDATE bookings SET remind_1h_sent = 1 WHERE id = ?").run(booking.id);
      sent1h.push(booking.id);
    } catch (err) {
      console.error("[cron:reminders] 1h reminder failed for", booking.id, err);
    }
  }

  return NextResponse.json({
    sent_24h: sent24h,
    sent_1h: sent1h,
    total: sent24h.length + sent1h.length,
  });
}

// Also support GET for Vercel Cron (which sends GET by default)
export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
