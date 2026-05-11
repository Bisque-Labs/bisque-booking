/**
 * Database migration — runs on app startup.
 *
 * Creates all tables if they do not exist.
 * Idempotent: safe to call on every cold start.
 */

import type Database from "better-sqlite3";

const DDL = `
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','rescheduled')),
  cancel_token TEXT NOT NULL UNIQUE,
  reschedule_token TEXT NOT NULL UNIQUE,
  remind_24h_sent INTEGER NOT NULL DEFAULT 0,
  remind_1h_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS availability_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS booking_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  buffer_minutes INTEGER NOT NULL DEFAULT 15,
  max_bookings_per_day INTEGER NOT NULL DEFAULT 8,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
  admin_timezone TEXT NOT NULL DEFAULT 'UTC',
  admin_email TEXT NOT NULL DEFAULT '',
  admin_name TEXT NOT NULL DEFAULT '',
  google_credentials_encrypted TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Seed default config row if empty
INSERT OR IGNORE INTO booking_config (id) VALUES (1);

CREATE INDEX IF NOT EXISTS idx_bookings_start_utc ON bookings (start_utc);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_contact_email ON bookings (contact_email);
`;

export function runMigrations(db: Database.Database): void {
  db.exec(DDL);
}
