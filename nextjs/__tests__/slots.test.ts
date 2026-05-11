/**
 * Slot engine tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";
import { generateSlots } from "@/lib/slots/engine";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

function seedConfig(db: Database.Database, overrides: Record<string, unknown> = {}) {
  db.prepare(`
    UPDATE booking_config SET
      buffer_minutes = @buffer_minutes,
      max_bookings_per_day = @max_bookings_per_day,
      slot_duration_minutes = @slot_duration_minutes,
      admin_timezone = @admin_timezone,
      admin_email = @admin_email,
      admin_name = @admin_name
    WHERE id = 1
  `).run({
    buffer_minutes: 15,
    max_bookings_per_day: 8,
    slot_duration_minutes: 30,
    admin_timezone: "UTC",
    admin_email: "admin@example.com",
    admin_name: "Test Admin",
    ...overrides,
  });
}

function seedWindow(
  db: Database.Database,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  timezone = "UTC"
) {
  db.prepare(
    "INSERT INTO availability_windows (day_of_week, start_time, end_time, timezone) VALUES (?, ?, ?, ?)"
  ).run(dayOfWeek, startTime, endTime, timezone);
}

describe("generateSlots", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedConfig(db);
  });

  it("returns empty array when no availability windows exist", () => {
    // 2099-01-05 is a Monday
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });
    expect(slots).toEqual([]);
  });

  it("returns slots for a day with availability windows", () => {
    // Monday = 1, seed a 2-hour window: 10:00-12:00
    // 2099-01-05 is a Monday
    seedWindow(db, 1, "10:00", "12:00", "UTC");

    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    // 2-hour window / 30-minute slots = 4 slots
    expect(slots).toHaveLength(4);
    expect(slots[0].start_utc).toContain("10:00");
    expect(slots[3].start_utc).toContain("11:30");
  });

  it("returns empty array when date is blocked", () => {
    // 2099-01-05 is a Monday
    seedWindow(db, 1, "10:00", "12:00", "UTC");
    db.prepare(
      "INSERT INTO blocked_dates (start_date, end_date) VALUES (?, ?)"
    ).run("2099-01-05", "2099-01-05");

    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });
    expect(slots).toEqual([]);
  });

  it("excludes slots that overlap with existing bookings", () => {
    // 2099-01-05 is a Monday
    seedWindow(db, 1, "10:00", "12:00", "UTC");

    // Book the 10:00 slot
    db.prepare(`
      INSERT INTO bookings
        (id, contact_name, contact_email, start_utc, end_utc, timezone, status, cancel_token, reschedule_token)
      VALUES
        ('test-id', 'Test User', 'test@example.com', '2099-01-05T10:00:00.000Z', '2099-01-05T10:30:00.000Z', 'UTC', 'confirmed', 'tok1', 'tok2')
    `).run();

    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    // 10:00 slot is taken, and buffer (15 min) eats into 10:30 slot
    // So 10:00 and 10:30 (within buffer of 10:30 booking end) should be gone
    const startTimes = slots.map((s) => s.start_utc);
    expect(startTimes.some((t) => t.includes("10:00"))).toBe(false);
    expect(startTimes.some((t) => t.includes("10:30"))).toBe(false);
    // 11:00 and 11:30 should remain
    expect(startTimes.some((t) => t.includes("11:00"))).toBe(true);
    expect(startTimes.some((t) => t.includes("11:30"))).toBe(true);
  });

  it("includes start_local and end_local formatted strings", () => {
    // 2099-01-05 is a Monday
    seedWindow(db, 1, "10:00", "10:30", "UTC");

    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });
    expect(slots[0].start_local).toBeDefined();
    expect(typeof slots[0].start_local).toBe("string");
  });
});
