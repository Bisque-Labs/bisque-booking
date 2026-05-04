/**
 * Hono middleware — require authenticated user.
 * Reads the `session` cookie (JWT), verifies it, and attaches the user to context.
 * Returns 401 if the token is missing, invalid, or expired.
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { decodeAccessToken } from "@/auth/tokens";
import { getDb, users } from "@/db";

export interface AuthVariables {
  userId: number;
}

/**
 * requireAuth — attach to any route that needs a logged-in user.
 *
 * After this middleware runs, `c.get("userId")` returns the current user's ID.
 * Use `requireUser(c)` from the route handler to fetch the full user record.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, "session");
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const payload = await decodeAccessToken(token);
  if (!payload?.sub) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  const userId = parseInt(payload.sub, 10);
  if (isNaN(userId)) {
    return c.json({ error: "Invalid session" }, 401);
  }

  // Verify user still exists and is active
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.isActive) {
    return c.json({ error: "User not found or inactive" }, 401);
  }

  c.set("userId", userId);
  await next();
}
