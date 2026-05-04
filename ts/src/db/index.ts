/**
 * Database connection — Drizzle ORM.
 *
 * Automatically selects the correct driver:
 *   - Vercel / Neon serverless: uses @neondatabase/serverless (HTTP transport)
 *     when the VERCEL env var is set, OR when NEON_HTTP=1 is set.
 *   - Local / Docker Postgres: falls back to the `postgres` TCP driver.
 *
 * Usage:
 *   import { db } from "@/db";
 *   const users = await db.select().from(usersTable);
 */

import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/config";
import * as schema from "./schema";

// The "any" typed union lets us use a single variable for both driver types
// without needing a common supertype. All callers use the same Drizzle query API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

let _db: AnyDb | null = null;
let _pgClient: ReturnType<typeof postgres> | null = null;

/** Returns true when running on Vercel (or in any HTTP-only serverless env). */
function isServerless(): boolean {
  return process.env["VERCEL"] === "1" || process.env["NEON_HTTP"] === "1";
}

/**
 * Async initialiser — must be called once before using `db` on serverless.
 * On local/Docker it is a no-op (the sync path handles init lazily).
 */
export async function initDb(): Promise<void> {
  if (_db !== null) return;
  if (isServerless()) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const config = getConfig();
    const sql = neon(config.DATABASE_URL);
    _db = drizzle(sql, { schema });
  }
  // Non-serverless init happens lazily in getDb().
}

/**
 * Synchronous getter — always returns a db instance.
 * On serverless you should call initDb() first (done in api/index.ts).
 * On local it initialises the postgres driver on first call.
 */
export function getDb(): ReturnType<typeof drizzlePg<typeof schema>> {
  if (_db !== null) return _db as ReturnType<typeof drizzlePg<typeof schema>>;

  if (isServerless()) {
    // initDb() hasn't been awaited yet — this is a programming error.
    throw new Error(
      "Database not yet initialised — await initDb() before handling requests",
    );
  }

  // Local / Docker path — initialise synchronously.
  const config = getConfig();
  _pgClient = postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  _db = drizzlePg(_pgClient, { schema });
  return _db as ReturnType<typeof drizzlePg<typeof schema>>;
}

/**
 * Convenience re-export — use this in most places.
 * The Proxy ensures getDb() is called lazily on first property access.
 */
export const db = new Proxy(
  {} as ReturnType<typeof drizzlePg<typeof schema>>,
  {
    get(_target, prop) {
      const instance = getDb();
      return (instance as unknown as Record<string | symbol, unknown>)[prop];
    },
  },
);

/**
 * Close the connection pool. Call during graceful shutdown or in tests.
 * No-op on Neon HTTP (connections are stateless HTTP requests).
 */
export async function closeDb(): Promise<void> {
  if (_pgClient !== null) {
    await _pgClient.end();
    _pgClient = null;
    _db = null;
  }
}

// Re-export schema for convenience
export * from "./schema";
