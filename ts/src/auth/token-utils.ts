/**
 * Miscellaneous token/slug utilities.
 * Mirrors app/services/auth.py → generate_token
 * and app/routers/auth.py → _slugify / _unique_slug.
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { users } from "@/db/schema";

/**
 * Generate a URL-safe random token.
 * `length` is the number of random bytes (output will be base64url-encoded,
 * so the string length will be approximately ⌈4/3 * length⌉).
 *
 * Matches Python's secrets.token_urlsafe(32).
 */
export function generateToken(length: number = 32): string {
  return randomBytes(length)
    .toString("base64url")
    .replace(/=/g, ""); // base64url is already padding-free in Node 16+
}

/**
 * Convert a display name to a URL-safe slug (max 32 chars).
 * Matches Python's _slugify() in app/routers/auth.py.
 */
export function slugify(name: string): string {
  let slug = name.toLowerCase().trim();
  slug = slug.replace(/[^\w\s-]/g, "");
  slug = slug.replace(/[\s_-]+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  return slug.slice(0, 32);
}

/**
 * Find a slug that doesn't conflict with existing users.
 * Appends -1, -2, … until unique.
 */
export async function uniqueSlug(
  base: string,
  db: PostgresJsDatabase<typeof schema>,
): Promise<string> {
  let slug = base;
  let i = 1;
  while (true) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.slug, slug))
      .limit(1);
    if (existing.length === 0) return slug;
    slug = `${base}-${i}`;
    i++;
  }
}
