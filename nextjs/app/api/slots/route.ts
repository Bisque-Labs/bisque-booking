/**
 * GET /api/slots?date=YYYY-MM-DD&tz=America/New_York
 *
 * Returns available booking slots for the given date.
 * Optionally subtracts Google Calendar busy blocks when GOOGLE_CALENDAR_CREDENTIALS is set.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateSlots } from "@/lib/slots/engine";
import { getGoogleBusyBlocks } from "@/lib/google-calendar";
import type { AvailableSlot } from "@/lib/db/schema";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const tz = searchParams.get("tz") ?? "UTC";

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date parameter required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  try {
    const db = getDb();
    let slots: AvailableSlot[] = generateSlots(db, { date, timezone: tz });

    // Subtract Google Calendar busy blocks (BIS-663)
    // Falls back gracefully if Google API is unavailable
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      try {
        const [year, month, day] = date.split("-").map(Number);
        const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const dayEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));

        const busyBlocks = await getGoogleBusyBlocks(db, dayStart, dayEnd);

        if (busyBlocks.length > 0) {
          slots = slots.filter((slot) => {
            const slotStart = new Date(slot.start_utc).getTime();
            const slotEnd = new Date(slot.end_utc).getTime();
            return !busyBlocks.some(
              (block) => slotStart < block.end && slotEnd > block.start
            );
          });
        }
      } catch (err) {
        // Google API failure → return config-based slots as fallback
        console.error("[slots] Google Calendar error (using config-based slots):", err);
      }
    }

    return NextResponse.json({ date, timezone: tz, slots });
  } catch (err) {
    console.error("[GET /api/slots]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
