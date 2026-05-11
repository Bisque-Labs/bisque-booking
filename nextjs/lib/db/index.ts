/**
 * Database singleton.
 *
 * Returns the same better-sqlite3 connection across hot-reloads in dev
 * and across the lifetime of the process in production.
 *
 * DATABASE_PATH env var sets the file location; defaults to ./data/bookings.db
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./migrate";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "bookings.db");

// Ensure the directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Module-level singleton (survives Next.js hot-reload via globalThis)
declare global {
  // eslint-disable-next-line no-var
  var __bisque_db: Database.Database | undefined;
}

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (process.env.NODE_ENV === "production") {
    // In production, create once and reuse
    if (!global.__bisque_db) {
      global.__bisque_db = openDb();
    }
    return global.__bisque_db;
  }

  // In development, use globalThis to survive hot-reloads
  if (!global.__bisque_db) {
    global.__bisque_db = openDb();
  }
  return global.__bisque_db;
}
