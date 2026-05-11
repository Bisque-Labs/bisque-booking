/**
 * Database migration and schema tests.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrate";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("runMigrations", () => {
  it("creates all required tables", () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("bookings");
    expect(tableNames).toContain("availability_windows");
    expect(tableNames).toContain("blocked_dates");
    expect(tableNames).toContain("booking_config");
  });

  it("seeds default config row", () => {
    const db = createTestDb();
    const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as Record<string, unknown> | undefined;
    expect(config).toBeDefined();
    expect(config!.buffer_minutes).toBe(15);
    expect(config!.slot_duration_minutes).toBe(30);
  });

  it("is idempotent — safe to run twice", () => {
    const db = createTestDb();
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("creates the bookings table with correct columns", () => {
    const db = createTestDb();
    const cols = db
      .prepare("PRAGMA table_info(bookings)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("id");
    expect(colNames).toContain("contact_name");
    expect(colNames).toContain("contact_email");
    expect(colNames).toContain("start_utc");
    expect(colNames).toContain("end_utc");
    expect(colNames).toContain("timezone");
    expect(colNames).toContain("cancel_token");
    expect(colNames).toContain("reschedule_token");
    expect(colNames).toContain("remind_24h_sent");
    expect(colNames).toContain("remind_1h_sent");
    expect(colNames).toContain("status");
  });
});
