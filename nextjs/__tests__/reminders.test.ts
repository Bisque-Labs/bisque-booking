/**
 * Reminders cron tests (BIS-667).
 *
 * Tests the reminder window logic and idempotency.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";
import type { Booking } from "@/lib/db/schema";
import { randomBytes } from "crypto";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  return db;
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

function insertBooking(
  db: Database.Database,
  startUtc: string,
  endUtc: string,
  opts: { remind_24h_sent?: number; remind_1h_sent?: number; status?: string } = {}
): Booking {
  const id = randomBytes(16).toString("hex");
  db.prepare(`
    INSERT INTO bookings
      (id, contact_name, contact_email, start_utc, end_utc, timezone, status, cancel_token, reschedule_token, remind_24h_sent, remind_1h_sent, created_at)
    VALUES
      (?, 'Test User', 'test@example.com', ?, ?, 'UTC', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).run(
    id,
    startUtc,
    endUtc,
    opts.status ?? "confirmed",
    generateToken(),
    generateToken(),
    opts.remind_24h_sent ?? 0,
    opts.remind_1h_sent ?? 0
  );
  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Booking;
}

/** Simulate the reminder query logic from the cron route */
function queryDue24h(db: Database.Database, now: number): Booking[] {
  const window24hStart = new Date(now + (23 * 60 + 45) * 60 * 1000).toISOString();
  const window24hEnd = new Date(now + (24 * 60 + 15) * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM bookings
    WHERE remind_24h_sent = 0
      AND status = 'confirmed'
      AND start_utc >= ?
      AND start_utc <= ?
  `).all(window24hStart, window24hEnd) as Booking[];
}

function queryDue1h(db: Database.Database, now: number): Booking[] {
  const window1hStart = new Date(now + 45 * 60 * 1000).toISOString();
  const window1hEnd = new Date(now + 75 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM bookings
    WHERE remind_1h_sent = 0
      AND status = 'confirmed'
      AND start_utc >= ?
      AND start_utc <= ?
  `).all(window1hStart, window1hEnd) as Booking[];
}

describe("Reminders cron (BIS-667)", () => {
  let db: Database.Database;
  const now = Date.now();

  beforeEach(() => {
    db = createTestDb();
  });

  it("identifies booking in the 24h window", () => {
    // 24h from now (within window)
    const start = new Date(now + 24 * 3600_000).toISOString();
    const end = new Date(now + 24 * 3600_000 + 1800_000).toISOString();
    insertBooking(db, start, end);

    const due = queryDue24h(db, now);
    expect(due).toHaveLength(1);
  });

  it("does not re-send if remind_24h_sent = 1 (idempotent)", () => {
    const start = new Date(now + 24 * 3600_000).toISOString();
    const end = new Date(now + 24 * 3600_000 + 1800_000).toISOString();
    insertBooking(db, start, end, { remind_24h_sent: 1 });

    const due = queryDue24h(db, now);
    expect(due).toHaveLength(0);
  });

  it("calling twice in same window sends no duplicates (flag set after send)", () => {
    const start = new Date(now + 24 * 3600_000).toISOString();
    const end = new Date(now + 24 * 3600_000 + 1800_000).toISOString();
    const booking = insertBooking(db, start, end);

    // First pass
    const due1 = queryDue24h(db, now);
    expect(due1).toHaveLength(1);

    // Simulate sending and marking flag
    db.prepare("UPDATE bookings SET remind_24h_sent = 1 WHERE id = ?").run(booking.id);

    // Second pass — should find nothing
    const due2 = queryDue24h(db, now);
    expect(due2).toHaveLength(0);
  });

  it("identifies booking in the 1h window", () => {
    const start = new Date(now + 60 * 60 * 1000).toISOString(); // exactly 1h out
    const end = new Date(now + 60 * 60 * 1000 + 1800_000).toISOString();
    insertBooking(db, start, end);

    const due = queryDue1h(db, now);
    expect(due).toHaveLength(1);
  });

  it("does not send 1h reminder if remind_1h_sent = 1", () => {
    const start = new Date(now + 60 * 60 * 1000).toISOString();
    const end = new Date(now + 60 * 60 * 1000 + 1800_000).toISOString();
    insertBooking(db, start, end, { remind_1h_sent: 1 });

    const due = queryDue1h(db, now);
    expect(due).toHaveLength(0);
  });

  it("does not send reminder to cancelled bookings", () => {
    const start = new Date(now + 24 * 3600_000).toISOString();
    const end = new Date(now + 24 * 3600_000 + 1800_000).toISOString();
    insertBooking(db, start, end, { status: "cancelled" });

    const due = queryDue24h(db, now);
    expect(due).toHaveLength(0);
  });

  it("booking outside 24h window is not in results", () => {
    // Booking 26 hours out (outside 23h45m - 24h15m window)
    const start = new Date(now + 26 * 3600_000).toISOString();
    const end = new Date(now + 26 * 3600_000 + 1800_000).toISOString();
    insertBooking(db, start, end);

    const due = queryDue24h(db, now);
    expect(due).toHaveLength(0);
  });

  it("booking outside 1h window is not in results", () => {
    // Booking 90 minutes out (outside 45m-75m window)
    const start = new Date(now + 90 * 60 * 1000).toISOString();
    const end = new Date(now + 90 * 60 * 1000 + 1800_000).toISOString();
    insertBooking(db, start, end);

    const due = queryDue1h(db, now);
    expect(due).toHaveLength(0);
  });

  it("reminder flag reset to 0 after reschedule enables re-send", () => {
    const start = new Date(now + 24 * 3600_000).toISOString();
    const end = new Date(now + 24 * 3600_000 + 1800_000).toISOString();
    const booking = insertBooking(db, start, end, { remind_24h_sent: 1 });

    // Reschedule: reset flags
    db.prepare("UPDATE bookings SET remind_24h_sent = 0, remind_1h_sent = 0 WHERE id = ?").run(booking.id);

    const due = queryDue24h(db, now);
    expect(due).toHaveLength(1);
  });
});
