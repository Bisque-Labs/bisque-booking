/**
 * POST /api/bookings/:id/reschedule?token=<reschedule_token>
 *
 * Validates the reschedule token, checks new slot availability,
 * updates the booking with new times, issues new tokens,
 * and sends reschedule confirmation email.
 *
 * Token is single-use — after use, new tokens are issued and old ones are invalidated.
 * Attempting to reuse a consumed token returns 410.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { sendRescheduleConfirmationEmail } from "@/lib/email";
import type { Booking, BookingConfig } from "@/lib/db/schema";

interface Params {
  params: { id: string };
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "reschedule token required" }, { status: 400 });
  }

  const db = getDb();
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Token must match
  if (booking.reschedule_token !== token) {
    return NextResponse.json({ error: "Invalid reschedule token" }, { status: 403 });
  }

  // Cancelled/already-rescheduled → token consumed → 410 Gone
  if (booking.status === "cancelled" || booking.status === "rescheduled") {
    return NextResponse.json({ error: "This reschedule link has expired" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { start_utc, end_utc, timezone } = body as Record<string, string>;

  if (!start_utc || !end_utc) {
    return NextResponse.json({ error: "start_utc and end_utc are required" }, { status: 400 });
  }

  const newStart = new Date(start_utc);
  const newEnd = new Date(end_utc);

  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
    return NextResponse.json({ error: "Invalid start_utc or end_utc" }, { status: 400 });
  }

  if (newEnd <= newStart) {
    return NextResponse.json({ error: "end_utc must be after start_utc" }, { status: 400 });
  }

  if (newStart.getTime() < Date.now()) {
    return NextResponse.json({ error: "Cannot reschedule to a past slot" }, { status: 400 });
  }

  // Check new slot availability (excluding current booking)
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;
  const bufferMs = (config?.buffer_minutes ?? 15) * 60 * 1000;
  const bufferStart = new Date(newStart.getTime() - bufferMs).toISOString();
  const bufferEnd = new Date(newEnd.getTime() + bufferMs).toISOString();

  const conflict = db
    .prepare(
      "SELECT id FROM bookings WHERE id != ? AND status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?"
    )
    .get(params.id, bufferEnd, bufferStart);

  if (conflict) {
    return NextResponse.json({ error: "This slot is no longer available" }, { status: 409 });
  }

  // Issue new tokens and update booking atomically
  const newCancelToken = generateToken();
  const newRescheduleToken = generateToken();
  const tz = timezone ?? booking.timezone ?? "UTC";

  db.prepare(`
    UPDATE bookings SET
      start_utc = ?,
      end_utc = ?,
      timezone = ?,
      status = 'confirmed',
      cancel_token = ?,
      reschedule_token = ?,
      remind_24h_sent = 0,
      remind_1h_sent = 0
    WHERE id = ?
  `).run(
    newStart.toISOString(),
    newEnd.toISOString(),
    tz,
    newCancelToken,
    newRescheduleToken,
    params.id
  );

  const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking;

  // Send reschedule confirmation (non-blocking)
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  sendRescheduleConfirmationEmail({
    bookingId: booking.id,
    contactName: booking.contact_name,
    contactEmail: booking.contact_email,
    startUtc: newStart.toISOString(),
    endUtc: newEnd.toISOString(),
    timezone: tz,
    notes: booking.notes,
    cancelToken: newCancelToken,
    rescheduleToken: newRescheduleToken,
    adminName: config?.admin_name ?? "Host",
    adminEmail: config?.admin_email ?? "",
    baseUrl,
  }).catch((err) => console.error("[email] reschedule email error", err));

  return NextResponse.json({ booking: updated });
}
