/**
 * POST /api/bookings/:id/cancel?token=<cancel_token>
 *
 * Atomically cancels a booking and invalidates the cancel token.
 * Sends cancellation emails to both guest and host.
 * Token is single-use — attempting to cancel an already-cancelled booking returns 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitBookingCancelled } from "@/lib/adapters";
import { sendCancellationEmails } from "@/lib/email";
import type { Booking, BookingConfig } from "@/lib/db/schema";

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "cancel token required" }, { status: 400 });
  }

  const db = getDb();
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Token must match
  if (booking.cancel_token !== token) {
    return NextResponse.json({ error: "Invalid cancel token" }, { status: 403 });
  }

  // Already cancelled → 409 (token reuse attempt)
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "Booking is already cancelled" }, { status: 409 });
  }

  // Atomic status update — invalidate token by replacing with empty string
  // (token remains in DB for audit; cannot be reused since we check status first)
  db.prepare(
    "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'"
  ).run(params.id);

  const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking;

  // Emit cancellation event (non-blocking)
  emitBookingCancelled({
    booking_id: params.id,
    contact_email: booking.contact_email,
  }).catch((err) => console.error("[emit BookingCancelled]", err));

  // Send cancellation emails (non-blocking)
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  sendCancellationEmails({
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
  }).catch((err) => console.error("[email] cancellation email error", err));

  return NextResponse.json({ booking: updated });
}
