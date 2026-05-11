/**
 * GET /api/bookings/by-reschedule-token/:token
 *
 * Look up a booking by its reschedule token.
 * Returns only the booking_id (enough for the frontend to compose the reschedule URL).
 * Returns 404 if not found or already cancelled/rescheduled.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Booking } from "@/lib/db/schema";

interface Params {
  params: { token: string };
}

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const db = getDb();
  const booking = db
    .prepare("SELECT id, status FROM bookings WHERE reschedule_token = ?")
    .get(params.token) as Pick<Booking, "id" | "status"> | undefined;

  if (!booking) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  if (booking.status === "cancelled" || booking.status === "rescheduled") {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  return NextResponse.json({ booking_id: booking.id });
}
