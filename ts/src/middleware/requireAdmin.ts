/**
 * Hono middleware — require admin role.
 * Must be composed AFTER requireAuth (relies on userId being set in context).
 */

import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { getDb, users } from "@/db";

/**
 * requireAdmin — return 403 if the current user is not an admin.
 * Chain after requireAuth: [requireAuth, requireAdmin]
 */
export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const userId = c.get("userId") as number | undefined;
  if (userId === undefined) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const db = getDb();
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  await next();
}
