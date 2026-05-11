/**
 * GET    /api/bookings/:id  — get a single booking
 * PATCH  /api/bookings/:id  — update booking status/notes
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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

  const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(params.id) as Booking;
  return NextResponse.json({ booking: updated });
}
