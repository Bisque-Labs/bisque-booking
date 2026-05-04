/**
 * Profile management routes.
 * Mirrors app/routers/profile.py.
 *
 * Routes:
 *   GET  /profile        → profile page (JSON response for now)
 *   PUT  /profile        → update name, slug, timezone
 *   POST /profile/password → change password
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, users } from "@/db";
import { requireAuth } from "@/middleware/auth";
import { hashPassword, verifyPassword } from "@/auth/password";

type Env = { Variables: { userId: number } };
const profile = new Hono<Env>();

// All profile routes require authentication
profile.use("*", requireAuth);

const profileUpdateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  timezone: z.string().default("UTC"),
});

profile.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      slug: users.slug,
      timezone: users.timezone,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

profile.put("/", zValidator("json", profileUpdateSchema), async (c) => {
  const userId = c.get("userId");
  const data = c.req.valid("json");
  const db = getDb();

  // Fetch current user to check slug change
  const currentRows = await db
    .select({ slug: users.slug })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = currentRows[0];
  if (!current) return c.json({ error: "User not found" }, 404);

  // Ensure new slug isn't taken by another user
  if (data.slug !== current.slug) {
    const conflictRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.slug, data.slug))
      .limit(1);
    if (conflictRows[0]) {
      return c.json({ error: "Slug already taken" }, 409);
    }
  }

  await db
    .update(users)
    .set({
      name: data.name,
      slug: data.slug,
      timezone: data.timezone,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return c.json({
    id: userId,
    slug: data.slug,
    name: data.name,
    timezone: data.timezone,
  });
});

const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
});

profile.post("/password", zValidator("json", changePasswordSchema), async (c) => {
  const userId = c.get("userId");
  const { current_password, new_password } = c.req.valid("json");
  const db = getDb();

  const rows = await db
    .select({ hashedPassword: users.hashedPassword })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return c.json({ error: "User not found" }, 404);

  // Verify current password if user has one
  if (user.hashedPassword) {
    if (!(await verifyPassword(current_password, user.hashedPassword))) {
      return c.json({ error: "Current password incorrect" }, 400);
    }
  }

  await db
    .update(users)
    .set({
      hashedPassword: await hashPassword(new_password),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return c.json({ updated: true });
});

export { profile as profileRouter };
