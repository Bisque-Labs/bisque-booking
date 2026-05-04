/**
 * Setup wizard routes — first-run admin creation.
 * Only available when no users exist. Mirrors app/routers/setup.py.
 *
 * Routes:
 *   GET  /setup   → setup page (redirects to / if already set up)
 *   POST /setup   → create first admin user
 */

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { count } from "drizzle-orm";
import { getDb, users } from "@/db";
import { createAccessToken } from "@/auth/tokens";
import { hashPassword } from "@/auth/password";
import { slugify, uniqueSlug } from "@/auth/token-utils";

const setup = new Hono();

async function hasUsers(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(users);
  return (rows[0]?.n ?? 0) > 0;
}

setup.get("/", async (c) => {
  if (await hasUsers()) {
    return c.redirect("/");
  }
  // In a full implementation this would render setup.html template.
  // For now, return a JSON hint so API clients know setup is needed.
  return c.json({ setupRequired: true });
});

setup.post("/", async (c) => {
  if (await hasUsers()) {
    return c.json({ error: "Setup already complete" }, 403);
  }

  const form = await c.req.formData();
  const name = String(form.get("name") ?? "");
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const slugInput = String(form.get("slug") ?? "") || undefined;
  const timezone = String(form.get("timezone") ?? "UTC");

  if (!name || !email || !password) {
    return c.json({ error: "Name, email, and password are required" }, 400);
  }

  const db = getDb();
  const baseSlug = slugInput ?? slugify(name) ?? email.split("@")[0] ?? "admin";
  const slug = await uniqueSlug(baseSlug, db);

  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      slug,
      role: "admin",
      timezone,
      hashedPassword: await hashPassword(password),
    })
    .returning();

  if (!user) {
    return c.json({ error: "Failed to create admin user" }, 500);
  }

  const token = await createAccessToken({ sub: String(user.id) });
  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 86400,
    path: "/",
  });

  return c.redirect("/dashboard");
});

export { setup as setupRouter };
