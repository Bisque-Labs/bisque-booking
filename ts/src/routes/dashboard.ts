/**
 * Consultant and admin dashboard routes.
 * Mirrors app/routers/dashboard.py.
 *
 * Routes:
 *   GET  /dashboard                         → upcoming bookings for current consultant
 *   GET  /dashboard/event-types             → list event types
 *   POST /dashboard/event-types             → create event type
 *   PUT  /dashboard/event-types/:id         → update event type
 *   DELETE /dashboard/event-types/:id       → delete event type
 *   GET  /dashboard/availability            → get availability rules
 *   POST /dashboard/availability            → replace availability rules
 *   GET  /dashboard/admin                   → admin overview (admin only)
 *   POST /dashboard/admin/users             → create user (admin only)
 *   PUT  /dashboard/admin/users/:id/deactivate → deactivate user (admin only)
 *   GET  /dashboard/admin/stats             → booking stats (admin only)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, gte, count } from "drizzle-orm";
import { getDb, users, eventTypes, availabilityRules, bookings } from "@/db";
import { requireAuth } from "@/middleware/auth";
import { requireAdmin } from "@/middleware/requireAdmin";
import { hashPassword } from "@/auth/password";
import { slugify, uniqueSlug } from "@/auth/token-utils";

type Env = { Variables: { userId: number } };
const dashboard = new Hono<Env>();

// All routes require auth
dashboard.use("*", requireAuth);

// ---------------------------------------------------------------------------
// Consultant dashboard
// ---------------------------------------------------------------------------

dashboard.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const now = new Date();

  const upcoming = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      clientEmail: bookings.clientEmail,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
      eventTypeId: bookings.eventTypeId,
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(bookings.eventTypeId, eventTypes.id))
    .where(
      and(
        eq(eventTypes.userId, userId),
        eq(bookings.status, "confirmed"),
        gte(bookings.startAt, now),
      ),
    )
    .orderBy(bookings.startAt)
    .limit(20);

  return c.json({ upcoming });
});

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

const intakeQuestionSchema = z.object({
  label: z.string(),
  required: z.boolean(),
  type: z.string(),
});

const eventTypeSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().default(30),
  bufferMinutes: z.number().int().min(0).default(0),
  minNoticeHours: z.number().int().min(0).default(1),
  maxHorizonDays: z.number().int().positive().default(30),
  color: z.string().default("#2563eb"),
  location: z.string().nullable().optional(),
  videoLink: z.string().nullable().optional(),
  intakeQuestions: z.array(intakeQuestionSchema).default([]),
  isActive: z.boolean().default(true),
});

dashboard.get("/event-types", async (c) => {
  const userId = c.get("userId");
  const db = getDb();

  const ets = await db
    .select()
    .from(eventTypes)
    .where(eq(eventTypes.userId, userId))
    .orderBy(eventTypes.id);

  return c.json(ets);
});

dashboard.post(
  "/event-types",
  zValidator("json", eventTypeSchema),
  async (c) => {
    const userId = c.get("userId");
    const data = c.req.valid("json");
    const db = getDb();

    const rows = await db
      .insert(eventTypes)
      .values({ ...data, userId })
      .returning({ id: eventTypes.id, slug: eventTypes.slug });

    return c.json(rows[0] ?? { id: null, slug: null }, 201);
  },
);

dashboard.put(
  "/event-types/:id",
  zValidator("json", eventTypeSchema),
  async (c) => {
    const userId = c.get("userId");
    const eventTypeId = parseInt(c.req.param("id"), 10);
    const data = c.req.valid("json");
    const db = getDb();

    const rows = await db
      .update(eventTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(eventTypes.id, eventTypeId), eq(eventTypes.userId, userId)))
      .returning({ id: eventTypes.id });

    if (!rows[0]) return c.json({ error: "Event type not found" }, 404);
    return c.json({ id: rows[0].id });
  },
);

dashboard.delete("/event-types/:id", async (c) => {
  const userId = c.get("userId");
  const eventTypeId = parseInt(c.req.param("id"), 10);
  const db = getDb();

  await db
    .delete(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), eq(eventTypes.userId, userId)));

  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Availability rules
// ---------------------------------------------------------------------------

const availabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  timezone: z.string().default("UTC"),
});

dashboard.get("/availability", async (c) => {
  const userId = c.get("userId");
  const db = getDb();

  const rules = await db
    .select()
    .from(availabilityRules)
    .where(eq(availabilityRules.userId, userId));

  return c.json(rules);
});

dashboard.post(
  "/availability",
  zValidator("json", z.array(availabilityRuleSchema)),
  async (c) => {
    const userId = c.get("userId");
    const rulesData = c.req.valid("json");
    const db = getDb();

    // Replace all existing rules for this user
    await db
      .delete(availabilityRules)
      .where(eq(availabilityRules.userId, userId));

    if (rulesData.length > 0) {
      await db.insert(availabilityRules).values(
        rulesData.map((r) => ({
          userId,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime.includes(":") && r.startTime.split(":").length === 2
            ? `${r.startTime}:00`
            : r.startTime,
          endTime: r.endTime.includes(":") && r.endTime.split(":").length === 2
            ? `${r.endTime}:00`
            : r.endTime,
          timezone: r.timezone,
        })),
      );
    }

    return c.json({ saved: rulesData.length });
  },
);

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  slug: z.string().optional(),
  role: z.enum(["admin", "consultant"]).default("consultant"),
  timezone: z.string().default("UTC"),
});

dashboard.get("/admin", requireAdmin, async (c) => {
  const db = getDb();
  const now = new Date();

  const allUsers = await db
    .select()
    .from(users)
    .orderBy(users.createdAt);

  const upcoming = await db
    .select({
      id: bookings.id,
      clientName: bookings.clientName,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
    })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), gte(bookings.startAt, now)))
    .orderBy(bookings.startAt)
    .limit(50);

  return c.json({ users: allUsers, upcoming });
});

dashboard.post(
  "/admin/users",
  requireAdmin,
  zValidator("json", createUserSchema),
  async (c) => {
    const data = c.req.valid("json");
    const db = getDb();

    const baseSlug =
      data.slug ?? slugify(data.name) ?? data.email.split("@")[0] ?? "user";
    const slug = await uniqueSlug(baseSlug, db);

    const rows = await db
      .insert(users)
      .values({
        email: data.email,
        name: data.name,
        slug,
        role: data.role,
        timezone: data.timezone,
        hashedPassword: await hashPassword(data.password),
      })
      .returning({ id: users.id, slug: users.slug });

    return c.json(rows[0] ?? { id: null, slug: null }, 201);
  },
);

dashboard.put("/admin/users/:id/deactivate", requireAdmin, async (c) => {
  const targetId = parseInt(c.req.param("id") ?? "0", 10);
  const db = getDb();

  await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, targetId));

  return c.json({ deactivated: true });
});

dashboard.get("/admin/stats", requireAdmin, async (c) => {
  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalRow] = await db
    .select({ n: count() })
    .from(bookings)
    .where(eq(bookings.status, "confirmed"));

  const [weeklyRow] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), gte(bookings.createdAt, weekAgo)));

  const [cancelledRow] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.status, "cancelled"), gte(bookings.createdAt, weekAgo)));

  return c.json({
    totalConfirmed: totalRow?.n ?? 0,
    confirmedLast7d: weeklyRow?.n ?? 0,
    cancelledLast7d: cancelledRow?.n ?? 0,
  });
});

export { dashboard as dashboardRouter };
