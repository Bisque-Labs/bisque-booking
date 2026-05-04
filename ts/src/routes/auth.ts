/**
 * Auth routes — Google OAuth and email/password login.
 * Mirrors app/routers/auth.py.
 *
 * Routes:
 *   GET  /auth/google          → redirect to Google OAuth
 *   GET  /auth/google/callback → handle OAuth callback
 *   POST /auth/login           → JSON email/password login
 *   POST /auth/login-form      → HTML form login (no-JS)
 *   POST /auth/register        → create new user
 *   POST /auth/logout          → clear session cookie
 *   GET  /auth/me              → current user info (requires auth)
 */

import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { getDb, users } from "@/db";
import { getConfig, getGoogleCallbackUrl } from "@/config";
import { createAccessToken } from "@/auth/tokens";
import { hashPassword, verifyPassword } from "@/auth/password";
import { generateToken, slugify, uniqueSlug } from "@/auth/token-utils";
import { encryptCredentials } from "@/auth/crypto";
import { requireAuth } from "@/middleware/auth";

type AuthEnv = { Variables: { userId: number } };
const auth = new Hono<AuthEnv>();

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];

/** Safely get first row from a DB result array. */
function first<T>(rows: T[]): T | undefined {
  return rows[0];
}

/** Count users in DB. */
async function countUsers(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(users);
  return first(rows)?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

auth.get("/google", (c) => {
  const cfg = getConfig();
  if (!cfg.GOOGLE_CLIENT_ID) {
    return c.json({ error: "Google OAuth not configured" }, 501);
  }

  const state = generateToken(16);
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 300,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleCallbackUrl(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

auth.get("/google/callback", async (c) => {
  const cfg = getConfig();
  const { code, state } = c.req.query();
  const expectedState = getCookie(c, "oauth_state");

  if (!expectedState || state !== expectedState) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }
  deleteCookie(c, "oauth_state", { path: "/" });

  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code ?? "",
      client_id: cfg.GOOGLE_CLIENT_ID,
      client_secret: cfg.GOOGLE_CLIENT_SECRET,
      redirect_uri: getGoogleCallbackUrl(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResp.ok) {
    return c.json({ error: "Failed to exchange OAuth code" }, 502);
  }
  const tokens = (await tokenResp.json()) as Record<string, unknown>;

  const userinfoResp = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens["access_token"]}` },
  });
  if (!userinfoResp.ok) {
    return c.json({ error: "Failed to fetch Google user info" }, 502);
  }
  const userinfo = (await userinfoResp.json()) as Record<string, unknown>;

  const googleId = String(userinfo["sub"] ?? "");
  const email = String(userinfo["email"] ?? "");
  const name = String(userinfo["name"] ?? email.split("@")[0] ?? "user");

  const db = getDb();

  let user =
    first(
      await db.select().from(users).where(eq(users.googleId, googleId)).limit(1),
    ) ??
    first(
      await db.select().from(users).where(eq(users.email, email)).limit(1),
    );

  if (!user) {
    const userCount = await countUsers();
    const role: "admin" | "consultant" = userCount === 0 ? "admin" : "consultant";
    const baseSlug = slugify(name) || email.split("@")[0] || "user";
    const slug = await uniqueSlug(baseSlug, db);

    user = first(
      await db
        .insert(users)
        .values({ email, name, slug, role, googleId })
        .returning(),
    );
  }

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  const updateData: Partial<typeof users.$inferInsert> = { googleId };
  if (cfg.ENCRYPTION_KEY) {
    updateData.googleCredentialsEncrypted = await encryptCredentials(
      JSON.stringify(tokens),
    );
  }
  await db.update(users).set(updateData).where(eq(users.id, user.id));

  const token = await createAccessToken({ sub: String(user.id) });
  setCookie(c, "session", token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 86400,
    path: "/",
  });
  return c.redirect("/dashboard");
});

// ---------------------------------------------------------------------------
// Email/password login
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const db = getDb();

  const user = first(
    await db.select().from(users).where(eq(users.email, email)).limit(1),
  );

  if (
    !user ||
    !user.isActive ||
    !user.hashedPassword ||
    !(await verifyPassword(password, user.hashedPassword))
  ) {
    return c.json({ error: "Invalid credentials" }, 401);
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

// HTML form login
auth.post("/login-form", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const db = getDb();
  const user = first(
    await db.select().from(users).where(eq(users.email, email)).limit(1),
  );

  if (
    !user ||
    !user.isActive ||
    !user.hashedPassword ||
    !(await verifyPassword(password, user.hashedPassword))
  ) {
    return c.redirect("/auth/login?error=Invalid+email+or+password");
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

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  slug: z.string().optional(),
});

auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");
  const db = getDb();

  const existing = first(
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1),
  );
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const userCount = await countUsers();
  const role: "admin" | "consultant" = userCount === 0 ? "admin" : "consultant";

  const baseSlug =
    body.slug ??
    slugify(body.name) ??
    body.email.split("@")[0] ??
    "user";
  const slug = await uniqueSlug(baseSlug, db);

  const user = first(
    await db
      .insert(users)
      .values({
        email: body.email,
        name: body.name,
        slug,
        role,
        hashedPassword: await hashPassword(body.password),
      })
      .returning(),
  );

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
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

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

auth.post("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

auth.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId") as number;
  const db = getDb();

  const user = first(
    await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        slug: users.slug,
        role: users.role,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
});

export { auth as authRouter };
