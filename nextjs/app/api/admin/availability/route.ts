/**
 * GET  /api/admin/availability  — get availability windows + config
 * PUT  /api/admin/availability  — replace all availability windows + update config
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { AvailabilityWindow, BookingConfig } from "@/lib/db/schema";

export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const windows = db
    .prepare("SELECT * FROM availability_windows ORDER BY day_of_week, start_time")
    .all() as AvailabilityWindow[];
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;

  return NextResponse.json({ windows, config });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { windows, config } = body as {
    windows?: Array<{ day_of_week: number; start_time: string; end_time: string; timezone?: string }>;
    config?: Partial<{
      buffer_minutes: number;
      max_bookings_per_day: number;
      slot_duration_minutes: number;
      admin_timezone: string;
      admin_email: string;
      admin_name: string;
    }>;
  };

  const db = getDb();

  // Validate windows
  if (windows) {
    for (const w of windows) {
      if (w.day_of_week < 0 || w.day_of_week > 6) {
        return NextResponse.json({ error: "day_of_week must be 0-6" }, { status: 400 });
      }
      if (!/^\d{2}:\d{2}$/.test(w.start_time) || !/^\d{2}:\d{2}$/.test(w.end_time)) {
        return NextResponse.json({ error: "Times must be in HH:MM format" }, { status: 400 });
      }
      if (w.start_time >= w.end_time) {
        return NextResponse.json(
          { error: `end_time (${w.end_time}) must be after start_time (${w.start_time})` },
          { status: 400 }
        );
      }
    }

    // Replace all windows atomically
    const replace = db.transaction(() => {
      db.prepare("DELETE FROM availability_windows").run();
      const insert = db.prepare(
        "INSERT INTO availability_windows (day_of_week, start_time, end_time, timezone) VALUES (?, ?, ?, ?)"
      );
      for (const w of windows) {
        insert.run(w.day_of_week, w.start_time, w.end_time, w.timezone ?? "UTC");
      }
    });
    replace();
  }

  // Update config if provided
  if (config) {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (config.buffer_minutes !== undefined) {
      if (config.buffer_minutes < 0 || config.buffer_minutes > 240) {
        return NextResponse.json({ error: "buffer_minutes must be 0-240" }, { status: 400 });
      }
      fields.push("buffer_minutes = ?");
      values.push(config.buffer_minutes);
    }
    if (config.max_bookings_per_day !== undefined) {
      fields.push("max_bookings_per_day = ?");
      values.push(config.max_bookings_per_day);
    }
    if (config.slot_duration_minutes !== undefined) {
      fields.push("slot_duration_minutes = ?");
      values.push(config.slot_duration_minutes);
    }
    if (config.admin_timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: config.admin_timezone });
      } catch {
        return NextResponse.json({ error: "Invalid admin_timezone" }, { status: 400 });
      }
      fields.push("admin_timezone = ?");
      values.push(config.admin_timezone);
    }
    if (config.admin_email !== undefined) {
      fields.push("admin_email = ?");
      values.push(config.admin_email);
    }
    if (config.admin_name !== undefined) {
      fields.push("admin_name = ?");
      values.push(config.admin_name);
    }

    if (fields.length > 0) {
      fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
      db.prepare(`UPDATE booking_config SET ${fields.join(", ")} WHERE id = 1`).run(...values);
    }
  }

  const updatedWindows = db
    .prepare("SELECT * FROM availability_windows ORDER BY day_of_week, start_time")
    .all() as AvailabilityWindow[];
  const updatedConfig = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig;

  return NextResponse.json({ windows: updatedWindows, config: updatedConfig });
}
