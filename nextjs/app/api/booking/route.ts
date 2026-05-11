/**
 * POST /api/booking  — create a new booking
 * GET  /api/booking  — list all bookings (admin only, future auth)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { emitBookingConfirmed } from "@/lib/adapters";
import type { Booking } from "@/lib/db/schema";

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

  // Check slot is not in the past
  if (startDate.getTime() < Date.now()) {
    return NextResponse.json({ error: "Cannot book a slot in the past" }, { status: 400 });
  }

  const db = getDb();

  // Check for conflicts with existing confirmed bookings
  const config = db.prepare("SELECT buffer_minutes FROM booking_config WHERE id = 1").get() as { buffer_minutes: number } | undefined;
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
    contact_name,
    contact_email,
    start_utc: startDate.toISOString(),
    end_utc: endDate.toISOString(),
    timezone: timezone ?? "UTC",
    notes: notes ?? null,
    cancel_token,
    reschedule_token,
    created_at: now,
  });

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Booking;

  // Emit event (non-blocking — adapter failures don't affect booking)
  emitBookingConfirmed({
    booking_id: id,
    contact_email,
    contact_name,
    start_utc: startDate.toISOString(),
    end_utc: endDate.toISOString(),
    notes: notes ?? null,
  }).catch((err) => console.error("[emit BookingConfirmed]", err));

  return NextResponse.json({ booking }, { status: 201 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // TODO: add admin auth middleware
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
