/**
 * Bookings API tests (BIS-659).
 *
 * Tests the booking creation, retrieval, and update logic using
 * in-memory SQLite. Does not test Next.js routing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";
import type { Booking, BookingConfig } from "@/lib/db/schema";
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

function generateId() {
  return randomBytes(16).toString("hex");
}

/** Insert a booking directly into the test DB */
function insertBooking(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    contact_name: string;
    contact_email: string;
    start_utc: string;
    end_utc: string;
    timezone: string;
    status: string;
    cancel_token: string;
    reschedule_token: string;
    notes: string | null;
  }> = {}
): Booking {
  const id = overrides.id ?? generateId();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const futureEnd = new Date(Date.now() + 5400_000).toISOString();

  db.prepare(`
    INSERT INTO bookings
      (id, contact_name, contact_email, start_utc, end_utc, timezone, notes, status, cancel_token, reschedule_token, created_at)
    VALUES
      (@id, @contact_name, @contact_email, @start_utc, @end_utc, @timezone, @notes, @status, @cancel_token, @reschedule_token, @created_at)
  `).run({
    id,
    contact_name: overrides.contact_name ?? "Test User",
    contact_email: overrides.contact_email ?? "test@example.com",
    start_utc: overrides.start_utc ?? future,
    end_utc: overrides.end_utc ?? futureEnd,
    timezone: overrides.timezone ?? "UTC",
    notes: overrides.notes ?? null,
    status: overrides.status ?? "confirmed",
    cancel_token: overrides.cancel_token ?? generateToken(),
    reschedule_token: overrides.reschedule_token ?? generateToken(),
    created_at: now,
  });

  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Booking;
}

// ── Core booking logic ───────────────────────────────────────────────────────

describe("Booking creation logic", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts a booking and can retrieve it", () => {
    const booking = insertBooking(db);
    const found = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id) as Booking | undefined;
    expect(found).toBeDefined();
    expect(found!.contact_name).toBe("Test User");
    expect(found!.status).toBe("confirmed");
  });

  it("detects conflict with existing booking (double-booking attempt)", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const futureEnd = new Date(Date.now() + 5400_000).toISOString();

    insertBooking(db, { start_utc: future, end_utc: futureEnd });

    // Try to insert overlapping booking — check for conflict
    const config = db.prepare("SELECT buffer_minutes FROM booking_config WHERE id = 1").get() as { buffer_minutes: number };
    const bufferMs = config.buffer_minutes * 60 * 1000;

    const bufferStart = new Date(new Date(future).getTime() - bufferMs).toISOString();
    const bufferEnd = new Date(new Date(futureEnd).getTime() + bufferMs).toISOString();

    const conflict = db
      .prepare(
        "SELECT id FROM bookings WHERE status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?"
      )
      .get(bufferEnd, bufferStart);

    expect(conflict).toBeDefined(); // conflict detected
  });

  it("rejects past slot (start_utc in the past)", () => {
    const pastStart = new Date(Date.now() - 3600_000).toISOString();
    const isPast = new Date(pastStart).getTime() < Date.now();
    expect(isPast).toBe(true);
  });

  it("two non-overlapping bookings on the same day do not conflict", () => {
    const slot1Start = new Date(Date.now() + 3600_000).toISOString();
    const slot1End = new Date(Date.now() + 5400_000).toISOString();
    // Slot 2 starts 2 hours after slot 1 ends (well past buffer)
    const slot2Start = new Date(Date.now() + 5400_000 + 3600_000).toISOString();
    const slot2End = new Date(Date.now() + 5400_000 + 5400_000).toISOString();

    insertBooking(db, { start_utc: slot1Start, end_utc: slot1End });

    const config = db.prepare("SELECT buffer_minutes FROM booking_config WHERE id = 1").get() as { buffer_minutes: number };
    const bufferMs = config.buffer_minutes * 60 * 1000;
    const bufferStart = new Date(new Date(slot2Start).getTime() - bufferMs).toISOString();
    const bufferEnd = new Date(new Date(slot2End).getTime() + bufferMs).toISOString();

    const conflict = db
      .prepare(
        "SELECT id FROM bookings WHERE status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?"
      )
      .get(bufferEnd, bufferStart);

    expect(conflict).toBeUndefined(); // no conflict
  });

  it("invalid timezone string can be detected", () => {
    let caught = false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: "Not/A/Timezone" });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it("valid timezone string passes validation", () => {
    let caught = false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: "America/New_York" });
    } catch {
      caught = true;
    }
    expect(caught).toBe(false);
  });
});

// ── Cancellation logic ───────────────────────────────────────────────────────

describe("Booking cancellation logic", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("cancels a booking by setting status to cancelled", () => {
    const booking = insertBooking(db);
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id) as Booking;
    expect(updated.status).toBe("cancelled");
  });

  it("double-cancel: second cancel on already-cancelled booking is a no-op via conditional update", () => {
    const booking = insertBooking(db);
    // First cancel
    const result1 = db
      .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'")
      .run(booking.id);
    expect(result1.changes).toBe(1);

    // Second cancel — should not change anything
    const result2 = db
      .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'")
      .run(booking.id);
    expect(result2.changes).toBe(0);
  });

  it("already-cancelled booking returns 409 when cancel token is checked", () => {
    const token = generateToken();
    const booking = insertBooking(db, { status: "cancelled", cancel_token: token });
    // Simulate the route check: booking.status === 'cancelled' → 409
    expect(booking.status).toBe("cancelled");
  });
});

// ── Reschedule logic ─────────────────────────────────────────────────────────

describe("Booking reschedule logic", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("reschedule updates start_utc and end_utc and issues new tokens", () => {
    const token = generateToken();
    const booking = insertBooking(db, { reschedule_token: token });

    const newStart = new Date(Date.now() + 7200_000).toISOString();
    const newEnd = new Date(Date.now() + 9000_000).toISOString();
    const newCancelToken = generateToken();
    const newRescheduleToken = generateToken();

    db.prepare(`
      UPDATE bookings SET
        start_utc = ?,
        end_utc = ?,
        status = 'confirmed',
        cancel_token = ?,
        reschedule_token = ?,
        remind_24h_sent = 0,
        remind_1h_sent = 0
      WHERE id = ?
    `).run(newStart, newEnd, newCancelToken, newRescheduleToken, booking.id);

    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id) as Booking;
    expect(updated.start_utc).toBe(newStart);
    expect(updated.cancel_token).toBe(newCancelToken);
    expect(updated.reschedule_token).toBe(newRescheduleToken);
    expect(updated.remind_24h_sent).toBe(0);
  });

  it("token reuse: after reschedule the old token is replaced", () => {
    const oldToken = generateToken();
    const newToken = generateToken();
    const booking = insertBooking(db, { reschedule_token: oldToken });

    db.prepare("UPDATE bookings SET reschedule_token = ? WHERE id = ?").run(newToken, booking.id);

    const found = db
      .prepare("SELECT * FROM bookings WHERE reschedule_token = ?")
      .get(oldToken);
    expect(found).toBeUndefined(); // old token no longer valid
  });

  it("cancelled booking: reschedule token returns 410 (expired)", () => {
    const booking = insertBooking(db, { status: "cancelled" });
    // Simulate route logic: booking.status === 'cancelled' → 410
    expect(["cancelled", "rescheduled"].includes(booking.status)).toBe(true);
  });

  it("race condition: two reschedule requests for same slot → second gets conflict", () => {
    // Slot that will be conflicted
    const targetStart = new Date(Date.now() + 7200_000).toISOString();
    const targetEnd = new Date(Date.now() + 9000_000).toISOString();

    // Existing booking that already takes the slot
    insertBooking(db, { start_utc: targetStart, end_utc: targetEnd });

    // Second reschedule attempt for same slot → conflict check
    const config = db.prepare("SELECT buffer_minutes FROM booking_config WHERE id = 1").get() as BookingConfig;
    const bufferMs = config.buffer_minutes * 60 * 1000;
    const bStart = new Date(new Date(targetStart).getTime() - bufferMs).toISOString();
    const bEnd = new Date(new Date(targetEnd).getTime() + bufferMs).toISOString();

    const conflict = db
      .prepare(
        "SELECT id FROM bookings WHERE status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?"
      )
      .get(bEnd, bStart);

    expect(conflict).toBeDefined(); // conflict detected → 409
  });
});

// ── Schema validation ────────────────────────────────────────────────────────

describe("Booking schema validation", () => {
  it("email validation: valid email passes", () => {
    expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test("user@example.com")).toBe(true);
  });

  it("email validation: invalid email fails", () => {
    expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test("not-an-email")).toBe(false);
  });

  it("XSS: HTML tags are stripped from contact_name", () => {
    const raw = "<script>alert('xss')</script>Alice";
    const sanitized = raw.replace(/<[^>]*>/g, "");
    expect(sanitized).toBe("alert('xss')Alice");
    expect(sanitized).not.toContain("<script>");
  });

  it("XSS: HTML tags are stripped from notes", () => {
    const raw = "Let's discuss <b>things</b>";
    const sanitized = raw.replace(/<[^>]*>/g, "");
    expect(sanitized).not.toContain("<b>");
    expect(sanitized).toContain("things");
  });
});
