/**
 * Database connection — Drizzle ORM over postgres driver.
 *
 * Usage:
 *   import { db } from "@/db";
 *   const users = await db.select().from(usersTable);
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/config";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

/**
 * Get (or create) the shared Drizzle database instance.
 * The underlying postgres connection pool is created once and reused.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db !== null) return _db;

  const config = getConfig();
  _client = postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  _db = drizzle(_client, { schema });
  return _db;
}

/**
 * Convenience re-export — use this in most places.
 * Equivalent to calling getDb() on first import.
 */
export const db = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop) {
      const instance = getDb();
      return (instance as unknown as Record<string | symbol, unknown>)[prop];
    },
  },
);

/**
 * Close the connection pool. Call during graceful shutdown or in tests.
 */
export async function closeDb(): Promise<void> {
  if (_client !== null) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

// Re-export schema for convenience
export * from "./schema";
