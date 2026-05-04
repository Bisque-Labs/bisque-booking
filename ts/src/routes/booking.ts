/**
 * Client-facing booking flow routes.
 * Mirrors app/routers/booking.py.
 *
 * Routes:
 *   GET  /:slug                          → booking page (user profile + event types)
 *   GET  /:slug/:eventTypeSlug/slots     → available slots for a date
 *   POST /:slug/:eventTypeSlug/book      → create a booking
 *   GET  /bookings/:token/cancel         → cancel a booking
 *   GET  /bookings/:token/reschedule     → begin reschedule
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, gte, lt } from "drizzle-orm";
import {
  getDb,
  users,
  eventTypes,
  availabilityRules,
  bookings,
} from "@/db";
import type { CalendarProvider, EmailProvider, WebhookProvider } from "@/providers/types";
import { NoopCalendarProvider, NoopEmailProvider, NoopWebhookProvider } from "@/providers/noop";
import { generateToken } from "@/auth/token-utils";
import {
  generateSlotsForDate,
  detectTimezoneWarning,
  overlapsAnyBusy,
  type BusyInterval,
  type CalendarDate,
} from "@/slots/engine";
import { generateIcs } from "@/ics";
import { getConfig } from "@/config";

const booking = new Hono();

// ---------------------------------------------------------------------------
// Provider injection (DI via closures — replaced by real providers in prod)
// ---------------------------------------------------------------------------

let _calendarProvider: CalendarProvider = new NoopCalendarProvider();
let _emailProvider: EmailProvider = new NoopEmailProvider();
let _webhookProvider: WebhookProvider = new NoopWebhookProvider();

export function setProviders(opts: {
  calendar?: CalendarProvider;
  email?: EmailProvider;
  webhook?: WebhookProvider;
}): void {
  if (opts.calendar) _calendarProvider = opts.calendar;
  if (opts.email) _emailProvider = opts.email;
  if (opts.webhook) _webhookProvider = opts.webhook;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

/** Convert a UTC Date to CalendarDate (year, month, day) in UTC. */
function toCalendarDate(d: Date): CalendarDate {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Set a UTC Date to midnight UTC. */
function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Get confirmed bookings for a user as busy intervals. */
async function getDbBusy(
  userId: number,
  start: Date,
  end: Date,
): Promise<BusyInterval[]> {
  const db = getDb();
  const rows = await db
    .select({ startAt: bookings.startAt, endAt: bookings.endAt })
    .from(bookings)
    .innerJoin(eventTypes, eq(bookings.eventTypeId, eventTypes.id))
    .where(
      and(
        eq(eventTypes.userId, userId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startAt, end),
        gte(bookings.endAt, start),
      ),
    );
  return rows.map((r): BusyInterval => [r.startAt, r.endAt]);
}

/** Load a user + event type or throw. */
async function loadUserAndEventType(
  slug: string,
  eventTypeSlug: string,
): Promise<{
  user: typeof users.$inferSelect;
  eventType: typeof eventTypes.$inferSelect;
  rules: typeof availabilityRules.$inferSelect[];
}> {
  const db = getDb();

  const user = first(
    await db
      .select()
      .from(users)
      .where(and(eq(users.slug, slug), eq(users.isActive, true)))
      .limit(1),
  );
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const eventType = first(
    await db
      .select()
      .from(eventTypes)
      .where(
        and(
          eq(eventTypes.userId, user.id),
          eq(eventTypes.slug, eventTypeSlug),
          eq(eventTypes.isActive, true),
        ),
      )
      .limit(1),
  );
  if (!eventType) {
    throw Object.assign(new Error("Event type not found"), { status: 404 });
  }

  const rules = await db
    .select()
    .from(availabilityRules)
    .where(eq(availabilityRules.userId, user.id));

  return { user, eventType, rules };
}

// ---------------------------------------------------------------------------
// Public booking page
// ---------------------------------------------------------------------------

booking.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  const user = first(
    await db
      .select({
        id: users.id,
        name: users.name,
        slug: users.slug,
        timezone: users.timezone,
      })
      .from(users)
      .where(and(eq(users.slug, slug), eq(users.isActive, true)))
      .limit(1),
  );
  if (!user) return c.json({ error: "Booking page not found" }, 404);

  const activeEventTypes = await db
    .select({
      id: eventTypes.id,
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      color: eventTypes.color,
      intakeQuestions: eventTypes.intakeQuestions,
    })
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, user.id), eq(eventTypes.isActive, true)))
    .orderBy(eventTypes.id);

  return c.json({ user, eventTypes: activeEventTypes });
});

// ---------------------------------------------------------------------------
// Slot availability API
// ---------------------------------------------------------------------------

booking.get("/:slug/:eventTypeSlug/slots", async (c) => {
  const slug = c.req.param("slug");
  const eventTypeSlug = c.req.param("eventTypeSlug");
  if (!slug || !eventTypeSlug) return c.json({ error: "Not found" }, 404);

  const dateStr = c.req.query("target_date");
  const clientTimezone = c.req.query("client_timezone") ?? "UTC";

  if (!dateStr) {
    return c.json({ error: "target_date is required (YYYY-MM-DD)" }, 400);
  }

  let targetDate: CalendarDate;
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) throw new Error("bad date");
    targetDate = { year: y, month: m, day: d };
  } catch {
    return c.json({ error: "Invalid target_date" }, 400);
  }

  let context: Awaited<ReturnType<typeof loadUserAndEventType>>;
  try {
    context = await loadUserAndEventType(slug, eventTypeSlug);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return c.json({ error: err.message ?? "Not found" }, (err.status as 404) ?? 404);
  }

  const { user, eventType, rules } = context;

  // Build the day window in UTC for free/busy lookup
  const dayJs = new Date(Date.UTC(targetDate.year, targetDate.month - 1, targetDate.day));
  const dayStart = dayJs;
  const dayEnd = new Date(dayJs.getTime() + 24 * 60 * 60 * 1000);

  const [calBusy, dbBusy] = await Promise.all([
    _calendarProvider.getFreeBusy(user.id, dayStart, dayEnd),
    getDbBusy(user.id, dayStart, dayEnd),
  ]);
  const allBusy = [...calBusy, ...dbBusy];

  const slots = generateSlotsForDate(
    targetDate,
    rules,
    allBusy,
    eventType,
    user.timezone,
  );

  const slotData = slots.map((slotUtc) => {
    const slotEndUtc = new Date(slotUtc.getTime() + eventType.durationMinutes * 60 * 1000);
    const warning = detectTimezoneWarning(slotUtc, slotEndUtc, user.timezone, clientTimezone);

    // Format local time using Intl
    const localStr = new Intl.DateTimeFormat("en-US", {
      timeZone: clientTimezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(slotUtc);

    return {
      utc: slotUtc.toISOString(),
      local: localStr,
      warning,
    };
  });

  return c.json({ date: dateStr, slots: slotData });
});

// ---------------------------------------------------------------------------
// Booking submission
// ---------------------------------------------------------------------------

const bookingRequestSchema = z.object({
  slotUtc: z.string().datetime(),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  clientTimezone: z.string().default("UTC"),
  intakeAnswers: z.record(z.unknown()).default({}),
});

booking.post(
  "/:slug/:eventTypeSlug/book",
  zValidator("json", bookingRequestSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const eventTypeSlug = c.req.param("eventTypeSlug");
    if (!slug || !eventTypeSlug) return c.json({ error: "Not found" }, 404);

    const data = c.req.valid("json");

    let context: Awaited<ReturnType<typeof loadUserAndEventType>>;
    try {
      context = await loadUserAndEventType(slug, eventTypeSlug);
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      return c.json({ error: err.message ?? "Not found" }, (err.status as 404) ?? 404);
    }

    const { user, eventType } = context;

    const startUtc = new Date(data.slotUtc);
    const endUtc = new Date(startUtc.getTime() + eventType.durationMinutes * 60 * 1000);

    // Double-check slot availability
    const dayStart = startOfDayUtc(startUtc);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [calBusy, dbBusy] = await Promise.all([
      _calendarProvider.getFreeBusy(user.id, dayStart, dayEnd),
      getDbBusy(user.id, dayStart, dayEnd),
    ]);

    const slotEndWithBuffer = new Date(
      endUtc.getTime() + eventType.bufferMinutes * 60 * 1000,
    );
    if (overlapsAnyBusy(startUtc, slotEndWithBuffer, [...calBusy, ...dbBusy])) {
      return c.json({ error: "Slot no longer available" }, 409);
    }

    // Insert booking
    const db = getDb();
    const cancelToken = generateToken();
    const rescheduleToken = generateToken();

    const newBooking = first(
      await db
        .insert(bookings)
        .values({
          eventTypeId: eventType.id,
          clientEmail: data.clientEmail,
          clientName: data.clientName,
          clientTimezone: data.clientTimezone,
          clientData: data.intakeAnswers as Record<string, unknown>,
          startAt: startUtc,
          endAt: endUtc,
          status: "confirmed",
          cancelToken,
          rescheduleToken,
        })
        .returning(),
    );

    if (!newBooking) {
      return c.json({ error: "Failed to create booking" }, 500);
    }

    // Build URLs
    const cfg = getConfig();
    const baseUrl = cfg.BASE_URL.replace(/\/$/, "");
    const cancelUrl = `${baseUrl}/bookings/${cancelToken}/cancel`;
    const rescheduleUrl = `${baseUrl}/bookings/${rescheduleToken}/reschedule`;

    // Try to create calendar event
    const description = [
      `Booking with ${data.clientName}`,
      "",
      ...Object.entries(data.intakeAnswers).map(([k, v]) => `${k}: ${v}`),
    ].join("\n");

    let googleEventId: string | null = null;
    try {
      googleEventId = await _calendarProvider.createEvent(
        user.id,
        `${eventType.title} — ${data.clientName}`,
        startUtc,
        endUtc,
        {
          description,
          attendeeEmail: data.clientEmail,
          createMeetLink: true,
        },
      );
      await db
        .update(bookings)
        .set({ googleEventId })
        .where(eq(bookings.id, newBooking.id));
    } catch {
      // Non-fatal: proceed without calendar event
    }

    // Generate ICS
    const icsContent = generateIcs({
      uid: `booking-${newBooking.id}@bisque-booking`,
      title: `${eventType.title} with ${user.name}`,
      start: startUtc,
      end: endUtc,
      organizerEmail: user.email,
      organizerName: user.name,
      attendeeEmail: data.clientEmail,
      attendeeName: data.clientName,
      description,
      location: eventType.videoLink ?? eventType.location ?? "",
    });
    const icsBuffer = Buffer.from(icsContent, "utf-8");

    // Send confirmation emails (non-fatal)
    try {
      await _emailProvider.sendConfirmationToClient({
        bookingId: newBooking.id,
        clientEmail: data.clientEmail,
        clientName: data.clientName,
        consultantName: user.name,
        start: startUtc,
        end: endUtc,
        clientTimezone: data.clientTimezone,
        cancelUrl,
        rescheduleUrl,
        videoLink: eventType.videoLink,
        icsContent: icsBuffer,
      });
      await _emailProvider.sendConfirmationToConsultant({
        bookingId: newBooking.id,
        consultantEmail: user.email,
        consultantName: user.name,
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientData: data.intakeAnswers as Record<string, unknown>,
        start: startUtc,
        end: endUtc,
        consultantTimezone: user.timezone,
        cancelUrl,
        icsContent: icsBuffer,
      });
    } catch (e) {
      console.error("Email sending failed:", e);
    }

    // Fire webhook (non-fatal)
    try {
      await _webhookProvider.dispatch("booking.created", {
        bookingId: newBooking.id,
        clientEmail: data.clientEmail,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        eventType: eventType.slug,
        consultantSlug: user.slug,
      });
    } catch {
      // Non-fatal
    }

    return c.json(
      {
        bookingId: newBooking.id,
        startAt: startUtc.toISOString(),
        endAt: endUtc.toISOString(),
        cancelUrl,
        rescheduleUrl,
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

booking.get("/bookings/:token/cancel", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  const bk = first(
    await db
      .select()
      .from(bookings)
      .where(eq(bookings.cancelToken, token))
      .limit(1),
  );

  if (!bk || bk.status === "cancelled") {
    return c.json({ error: "Booking not found or already cancelled" }, 404);
  }

  await db
    .update(bookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(bookings.id, bk.id));

  // Delete calendar event (non-fatal)
  if (bk.googleEventId) {
    const et = first(
      await db
        .select({ userId: eventTypes.userId })
        .from(eventTypes)
        .where(eq(eventTypes.id, bk.eventTypeId))
        .limit(1),
    );
    if (et) {
      try {
        await _calendarProvider.deleteEvent(et.userId, bk.googleEventId);
      } catch {
        // Non-fatal
      }
    }
  }

  // Send cancellation emails (non-fatal)
  try {
    await _emailProvider.sendCancellation({
      bookingId: bk.id,
      recipientEmail: bk.clientEmail,
      recipientName: bk.clientName,
      start: bk.startAt,
      end: bk.endAt,
      recipientTimezone: bk.clientTimezone,
      cancelledBy: "client",
    });
  } catch {
    // Non-fatal
  }

  return c.json({ status: "cancelled" });
});

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

booking.get("/bookings/:token/reschedule", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "Not found" }, 404);

  const db = getDb();
  const bk = first(
    await db
      .select()
      .from(bookings)
      .where(eq(bookings.rescheduleToken, token))
      .limit(1),
  );

  if (!bk) return c.json({ error: "Booking not found" }, 404);

  const et = first(
    await db
      .select({ userId: eventTypes.userId, slug: eventTypes.slug })
      .from(eventTypes)
      .where(eq(eventTypes.id, bk.eventTypeId))
      .limit(1),
  );
  if (!et) return c.json({ error: "Event type not found" }, 404);

  const user = first(
    await db
      .select({ slug: users.slug })
      .from(users)
      .where(eq(users.id, et.userId))
      .limit(1),
  );
  if (!user) return c.json({ error: "User not found" }, 404);

  await db
    .update(bookings)
    .set({ status: "rescheduled", updatedAt: new Date() })
    .where(eq(bookings.id, bk.id));

  return c.redirect(`/${user.slug}/${et.slug}`);
});

export { booking as bookingRouter };
