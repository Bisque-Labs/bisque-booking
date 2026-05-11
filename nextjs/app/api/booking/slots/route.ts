/**
 * GET /api/booking/slots?date=YYYY-MM-DD&tz=America/New_York
 *
 * Returns available booking slots for the given date.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateSlots } from "@/lib/slots/engine";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const tz = searchParams.get("tz") ?? "UTC";

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date parameter required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const db = getDb();
    const slots = generateSlots(db, { date, timezone: tz });
    return NextResponse.json({ date, timezone: tz, slots });
  } catch (err) {
    console.error("[GET /api/booking/slots]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
