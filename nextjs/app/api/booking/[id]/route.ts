/**
 * GET    /api/booking/:id  — get a single booking
 * PATCH  /api/booking/:id  — update booking status
 * DELETE /api/booking/:id  — cancel a booking
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitBookingCancelled } from "@/lib/adapters";
import type { Booking } from "@/lib/db/schema";

interface Params {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const db = getDb();
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json({ booking });
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const db = getDb();
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, notes } = body as Record<string, string>;
  const allowed = ["pending", "confirmed", "cancelled", "rescheduled"];

  if (status && !allowed.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${allowed.join(", ")}` }, { status: 400 });
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (status) { updates.push("status = ?"); values.push(status); }
  if (notes !== undefined) { updates.push("notes = ?"); values.push(notes); }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  db.prepare(`UPDATE bookings SET ${updates.join(", ")} WHERE id = ?`).run(...values, params.id);

  if (status === "cancelled") {
    emitBookingCancelled({
      booking_id: params.id,
      contact_email: booking.contact_email,
    }).catch((err) => console.error("[emit BookingCancelled]", err));
  }

  const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking;
  return NextResponse.json({ booking: updated });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const db = getDb();
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "Booking is already cancelled" }, { status: 400 });
  }

  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(params.id);

  emitBookingCancelled({
    booking_id: params.id,
    contact_email: booking.contact_email,
  }).catch((err) => console.error("[emit BookingCancelled]", err));

  return NextResponse.json({ success: true });
}
