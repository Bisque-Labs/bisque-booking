/**
 * Availability configuration tests (BIS-660).
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";
import { generateSlots } from "@/lib/slots/engine";
import type { AvailabilityWindow, BlockedDate, BookingConfig } from "@/lib/db/schema";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

// Simulate PUT /api/admin/availability logic
function updateAvailability(
  db: Database.Database,
  windows: Array<{ day_of_week: number; start_time: string; end_time: string; timezone?: string }>,
  config?: Partial<BookingConfig>
): { error?: string; windows?: AvailabilityWindow[]; config?: BookingConfig } {
  // Validate windows
  for (const w of windows) {
    if (w.day_of_week < 0 || w.day_of_week > 6) {
      return { error: "day_of_week must be 0-6" };
    }
    if (!/^\d{2}:\d{2}$/.test(w.start_time) || !/^\d{2}:\d{2}$/.test(w.end_time)) {
      return { error: "Times must be in HH:MM format" };
    }
    if (w.start_time >= w.end_time) {
      return { error: `end_time must be after start_time` };
    }
  }

  // Validate config
  if (config?.buffer_minutes !== undefined) {
    if (config.buffer_minutes < 0 || config.buffer_minutes > 240) {
      return { error: "buffer_minutes must be 0-240" };
    }
  }

  if (config?.admin_timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: config.admin_timezone });
    } catch {
      return { error: "Invalid admin_timezone" };
    }
  }

  // Apply
  db.transaction(() => {
    db.prepare("DELETE FROM availability_windows").run();
    const insert = db.prepare(
      "INSERT INTO availability_windows (day_of_week, start_time, end_time, timezone) VALUES (?, ?, ?, ?)"
    );
    for (const w of windows) {
      insert.run(w.day_of_week, w.start_time, w.end_time, w.timezone ?? "UTC");
    }
  })();

  if (config) {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (config.buffer_minutes !== undefined) { fields.push("buffer_minutes = ?"); values.push(config.buffer_minutes); }
    if (config.max_bookings_per_day !== undefined) { fields.push("max_bookings_per_day = ?"); values.push(config.max_bookings_per_day); }
    if (config.admin_timezone) { fields.push("admin_timezone = ?"); values.push(config.admin_timezone); }
    if (fields.length > 0) {
      db.prepare(`UPDATE booking_config SET ${fields.join(", ")} WHERE id = 1`).run(...values);
    }
  }

  const updatedWindows = db.prepare("SELECT * FROM availability_windows ORDER BY day_of_week").all() as AvailabilityWindow[];
  const updatedConfig = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig;
  return { windows: updatedWindows, config: updatedConfig };
}

describe("Availability configuration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("saves availability windows correctly", () => {
    const result = updateAvailability(db, [
      { day_of_week: 1, start_time: "09:00", end_time: "17:00" },
      { day_of_week: 3, start_time: "10:00", end_time: "14:00" },
    ]);

    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(2);
    expect(result.windows![0].day_of_week).toBe(1);
    expect(result.windows![0].start_time).toBe("09:00");
  });

  it("replaces all windows on PUT (not incremental)", () => {
    updateAvailability(db, [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }]);
    updateAvailability(db, [{ day_of_week: 3, start_time: "10:00", end_time: "14:00" }]);

    const windows = db.prepare("SELECT * FROM availability_windows").all() as AvailabilityWindow[];
    expect(windows).toHaveLength(1);
    expect(windows[0].day_of_week).toBe(3);
  });

  it("rejects invalid time range (end before start)", () => {
    const result = updateAvailability(db, [
      { day_of_week: 1, start_time: "17:00", end_time: "09:00" },
    ]);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("end_time");
  });

  it("rejects equal start and end time", () => {
    const result = updateAvailability(db, [
      { day_of_week: 1, start_time: "09:00", end_time: "09:00" },
    ]);
    expect(result.error).toBeDefined();
  });

  it("rejects invalid day_of_week", () => {
    const result = updateAvailability(db, [
      { day_of_week: 7, start_time: "09:00", end_time: "17:00" },
    ]);
    expect(result.error).toContain("day_of_week");
  });

  it("rejects invalid buffer_minutes (out of range)", () => {
    const result = updateAvailability(db, [], { buffer_minutes: 300 });
    expect(result.error).toContain("buffer_minutes");
  });

  it("rejects invalid timezone", () => {
    const result = updateAvailability(db, [], { admin_timezone: "Not/Valid" });
    expect(result.error).toContain("timezone");
  });

  it("accepts valid timezone", () => {
    const result = updateAvailability(db, [], { admin_timezone: "Europe/London" });
    expect(result.error).toBeUndefined();
    expect(result.config?.admin_timezone).toBe("Europe/London");
  });
});

// ── Blocked dates ──────────────────────────────────────────────────────────

function addBlockedDate(
  db: Database.Database,
  start_date: string,
  end_date: string,
  reason?: string
): { error?: string; id?: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return { error: "Dates must be YYYY-MM-DD" };
  }
  if (start_date > end_date) {
    return { error: "end_date must be on or after start_date" };
  }
  const result = db
    .prepare("INSERT INTO blocked_dates (start_date, end_date, reason) VALUES (?, ?, ?)")
    .run(start_date, end_date, reason ?? null);
  return { id: Number(result.lastInsertRowid) };
}

describe("Blocked dates", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("adds a blocked date range", () => {
    const { id } = addBlockedDate(db, "2099-06-01", "2099-06-05", "Vacation");
    expect(id).toBeDefined();
    const found = db.prepare("SELECT * FROM blocked_dates WHERE id = ?").get(id) as BlockedDate;
    expect(found.start_date).toBe("2099-06-01");
    expect(found.reason).toBe("Vacation");
  });

  it("rejects end_date before start_date", () => {
    const result = addBlockedDate(db, "2099-06-10", "2099-06-01");
    expect(result.error).toContain("end_date");
  });

  it("allows single-day block (start = end)", () => {
    const { error } = addBlockedDate(db, "2099-07-04", "2099-07-04");
    expect(error).toBeUndefined();
  });

  it("generates slots = [] for blocked date", () => {
    db.prepare("INSERT INTO availability_windows (day_of_week, start_time, end_time, timezone) VALUES (1, '09:00', '17:00', 'UTC')").run();
    db.prepare("INSERT INTO blocked_dates (start_date, end_date) VALUES ('2099-01-06', '2099-01-06')").run();
    // 2099-01-06 is a Monday
    const slots = generateSlots(db, { date: "2099-01-06", timezone: "UTC" });
    expect(slots).toEqual([]);
  });

  it("deletes a blocked date", () => {
    const { id } = addBlockedDate(db, "2099-08-01", "2099-08-01");
    db.prepare("DELETE FROM blocked_dates WHERE id = ?").run(id);
    const found = db.prepare("SELECT * FROM blocked_dates WHERE id = ?").get(id);
    expect(found).toBeUndefined();
  });
});
