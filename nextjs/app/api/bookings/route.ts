/**
 * POST /api/bookings  — create a new booking
 * GET  /api/bookings  — list all bookings (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { emitBookingConfirmed } from "@/lib/adapters";
import { sendGuestConfirmationEmail, sendHostNotificationEmail } from "@/lib/email";
import type { Booking, BookingConfig } from "@/lib/db/schema";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contact_name, contact_email, start_utc, end_utc, timezone, notes } = body as Record<string, string>;

  if (!contact_name || !contact_email || !start_utc || !end_utc) {
    return NextResponse.json(
      { error: "contact_name, contact_email, start_utc, end_utc are required" },
      { status: 400 }
    );
  }

  // Sanitize inputs (strip HTML/script injection)
  const safeName = String(contact_name).slice(0, 200).replace(/<[^>]*>/g, "");
  const safeNotes = notes ? String(notes).slice(0, 2000).replace(/<[^>]*>/g, "") : null;

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Validate dates
  const startDate = new Date(start_utc);
  const endDate = new Date(end_utc);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Invalid start_utc or end_utc" }, { status: 400 });
  }
  if (endDate <= startDate) {
    return NextResponse.json({ error: "end_utc must be after start_utc" }, { status: 400 });
  }

  // Validate timezone
  const tz = timezone ?? "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  // Check slot is not in the past
  if (startDate.getTime() < Date.now()) {
    return NextResponse.json({ error: "Cannot book a slot in the past" }, { status: 400 });
  }

  const db = getDb();

  // Check for conflicts with existing confirmed bookings
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;
  const bufferMs = (config?.buffer_minutes ?? 15) * 60 * 1000;
  const bufferStart = new Date(startDate.getTime() - bufferMs).toISOString();
  const bufferEnd = new Date(endDate.getTime() + bufferMs).toISOString();

  const conflict = db
    .prepare(
      "SELECT id FROM bookings WHERE status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?"
    )
    .get(bufferEnd, bufferStart);

  if (conflict) {
    return NextResponse.json({ error: "This slot is no longer available" }, { status: 409 });
  }

  const id = generateId();
  const cancel_token = generateToken();
  const reschedule_token = generateToken();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO bookings
      (id, contact_name, contact_email, start_utc, end_utc, timezone, notes,
       status, cancel_token, reschedule_token, created_at)
    VALUES
      (@id, @contact_name, @contact_email, @start_utc, @end_utc, @timezone, @notes,
       'confirmed', @cancel_token, @reschedule_token, @created_at)
  `);

  insert.run({
    id,
    contact_name: safeName,
    contact_email,
    start_utc: startDate.toISOString(),
    end_utc: endDate.toISOString(),
    timezone: tz,
    notes: safeNotes,
    cancel_token,
    reschedule_token,
    created_at: now,
  });

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Booking;

  // Emit adapter event (non-blocking)
  emitBookingConfirmed({
    booking_id: id,
    contact_email,
    contact_name: safeName,
    start_utc: startDate.toISOString(),
    end_utc: endDate.toISOString(),
    notes: safeNotes,
    timezone: tz,
  }).catch((err) => console.error("[emit BookingConfirmed]", err));

  // Send confirmation emails (non-blocking — email failure doesn't affect booking)
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const emailData = {
    bookingId: id,
    contactName: safeName,
    contactEmail: contact_email,
    startUtc: startDate.toISOString(),
    endUtc: endDate.toISOString(),
    timezone: tz,
    notes: safeNotes,
    cancelToken: cancel_token,
    rescheduleToken: reschedule_token,
    adminName: config?.admin_name ?? "Host",
    adminEmail: config?.admin_email ?? "",
    baseUrl,
  };

  Promise.allSettled([
    sendGuestConfirmationEmail(emailData),
    sendHostNotificationEmail(emailData),
  ]).catch((err) => console.error("[email] confirmation email error", err));

  return NextResponse.json({ booking }, { status: 201 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const db = getDb();
  let query = "SELECT * FROM bookings";
  const params: (string | number)[] = [];

  if (status) {
    query += " WHERE status = ?";
    params.push(status);
  }

  query += " ORDER BY start_utc ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const bookings = db.prepare(query).all(...params) as Booking[];
  return NextResponse.json({ bookings });
}
