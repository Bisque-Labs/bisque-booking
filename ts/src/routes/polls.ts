/**
 * Group availability poll routes.
 * Mirrors app/routers/polls.py.
 *
 * Routes:
 *   GET  /polls               → list current user's polls (auth required)
 *   POST /polls               → create a poll (auth required)
 *   GET  /polls/:shareToken   → view poll by share token (public)
 *   POST /polls/:shareToken/respond → submit availability response (public)
 *   POST /polls/:shareToken/confirm/:slotId → confirm winning slot (auth, creator only)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  getDb,
  availabilityPolls,
  pollSlots,
  pollResponses,
} from "@/db";
import { requireAuth } from "@/middleware/auth";
import { generateToken } from "@/auth/token-utils";
import { NoopEmailProvider } from "@/providers/noop";
import type { EmailProvider } from "@/providers/types";

type Env = { Variables: { userId: number } };
const polls = new Hono<Env>();

// Email provider injection (default noop; overridden in app setup)
let _emailProvider: EmailProvider = new NoopEmailProvider();
export function setPollEmailProvider(p: EmailProvider): void {
  _emailProvider = p;
}

function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

// ---------------------------------------------------------------------------
// List user's polls
// ---------------------------------------------------------------------------

polls.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const db = getDb();

  const userPolls = await db
    .select()
    .from(availabilityPolls)
    .where(eq(availabilityPolls.creatorId, userId))
    .orderBy(availabilityPolls.createdAt);

  // For each poll, count slots and responses
  const result = await Promise.all(
    userPolls.map(async (p) => {
      const slots = await db
        .select({ id: pollSlots.id })
        .from(pollSlots)
        .where(eq(pollSlots.pollId, p.id));

      const responses = await db
        .select({ id: pollResponses.id })
        .from(pollResponses)
        .where(eq(pollResponses.pollId, p.id));

      return {
        id: p.id,
        title: p.title,
        status: p.status,
        shareToken: p.shareToken,
        expiresAt: p.expiresAt?.toISOString() ?? null,
        responseCount: responses.length,
        slotCount: slots.length,
      };
    }),
  );

  return c.json(result);
});

// ---------------------------------------------------------------------------
// Create poll
// ---------------------------------------------------------------------------

const slotInputSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

const pollCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  slots: z.array(slotInputSchema).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

polls.post("/", requireAuth, zValidator("json", pollCreateSchema), async (c) => {
  const userId = c.get("userId");
  const data = c.req.valid("json");
  const db = getDb();

  const shareToken = generateToken();

  const [poll] = await db
    .insert(availabilityPolls)
    .values({
      creatorId: userId,
      title: data.title,
      description: data.description ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      shareToken,
    })
    .returning();

  if (!poll) {
    return c.json({ error: "Failed to create poll" }, 500);
  }

  if (data.slots.length > 0) {
    await db.insert(pollSlots).values(
      data.slots.map((s) => ({
        pollId: poll.id,
        startAt: new Date(s.startAt),
        endAt: new Date(s.endAt),
      })),
    );
  }

  return c.json({ pollId: poll.id, shareToken: poll.shareToken }, 201);
});

// ---------------------------------------------------------------------------
// View poll (public via share token)
// ---------------------------------------------------------------------------

polls.get("/:shareToken", async (c) => {
  const shareToken = c.req.param("shareToken");
  if (!shareToken) return c.json({ error: "Not found" }, 404);

  const db = getDb();

  const poll = first(
    await db
      .select()
      .from(availabilityPolls)
      .where(eq(availabilityPolls.shareToken, shareToken))
      .limit(1),
  );
  if (!poll) return c.json({ error: "Poll not found" }, 404);

  const slots = await db
    .select()
    .from(pollSlots)
    .where(eq(pollSlots.pollId, poll.id))
    .orderBy(pollSlots.startAt);

  const responses = await db
    .select()
    .from(pollResponses)
    .where(eq(pollResponses.pollId, poll.id));

  // Tally votes per slot
  const tally: Record<number, { yes: number; if_needed: number; no: number }> =
    {};
  for (const slot of slots) {
    tally[slot.id] = { yes: 0, if_needed: 0, no: 0 };
  }
  for (const resp of responses) {
    for (const [slotIdStr, answer] of Object.entries(resp.responses)) {
      const slotId = parseInt(slotIdStr, 10);
      const entry = tally[slotId];
      if (entry && (answer === "yes" || answer === "if_needed" || answer === "no")) {
        entry[answer]++;
      }
    }
  }

  return c.json({
    poll: {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      status: poll.status,
      expiresAt: poll.expiresAt?.toISOString() ?? null,
      confirmedSlotId: poll.confirmedSlotId,
    },
    slots: slots.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      tally: tally[s.id] ?? { yes: 0, if_needed: 0, no: 0 },
    })),
    responses: responses.map((r) => ({
      id: r.id,
      participantEmail: r.participantEmail,
      participantName: r.participantName,
      responses: r.responses,
    })),
  });
});

// ---------------------------------------------------------------------------
// Submit response (public)
// ---------------------------------------------------------------------------

const pollResponseSchema = z.object({
  participantEmail: z.string().email(),
  participantName: z.string().min(1),
  responses: z.record(z.enum(["yes", "if_needed", "no"])),
});

polls.post(
  "/:shareToken/respond",
  zValidator("json", pollResponseSchema),
  async (c) => {
    const shareToken = c.req.param("shareToken");
    if (!shareToken) return c.json({ error: "Not found" }, 404);

    const data = c.req.valid("json");
    const db = getDb();

    const poll = first(
      await db
        .select()
        .from(availabilityPolls)
        .where(
          and(
            eq(availabilityPolls.shareToken, shareToken),
            eq(availabilityPolls.status, "open"),
          ),
        )
        .limit(1),
    );
    if (!poll) return c.json({ error: "Poll not found or closed" }, 404);

    // Upsert by email
    const existing = first(
      await db
        .select()
        .from(pollResponses)
        .where(
          and(
            eq(pollResponses.pollId, poll.id),
            eq(pollResponses.participantEmail, data.participantEmail),
          ),
        )
        .limit(1),
    );

    if (existing) {
      await db
        .update(pollResponses)
        .set({
          responses: data.responses,
          participantName: data.participantName,
          updatedAt: new Date(),
        })
        .where(eq(pollResponses.id, existing.id));
    } else {
      await db.insert(pollResponses).values({
        pollId: poll.id,
        participantEmail: data.participantEmail,
        participantName: data.participantName,
        responses: data.responses,
      });
    }

    return c.json({ submitted: true });
  },
);

// ---------------------------------------------------------------------------
// Confirm winning slot (auth, creator only)
// ---------------------------------------------------------------------------

polls.post(
  "/:shareToken/confirm/:slotId",
  requireAuth,
  async (c) => {
    const shareToken = c.req.param("shareToken");
    const slotIdStr = c.req.param("slotId");
    if (!shareToken || !slotIdStr) return c.json({ error: "Not found" }, 404);

    const slotId = parseInt(slotIdStr, 10);
    const userId = c.get("userId");
    const db = getDb();

    const poll = first(
      await db
        .select()
        .from(availabilityPolls)
        .where(eq(availabilityPolls.shareToken, shareToken))
        .limit(1),
    );

    if (!poll || poll.creatorId !== userId) {
      return c.json({ error: "Not authorized" }, 403);
    }

    const slot = first(
      await db
        .select()
        .from(pollSlots)
        .where(
          and(eq(pollSlots.id, slotId), eq(pollSlots.pollId, poll.id)),
        )
        .limit(1),
    );
    if (!slot) return c.json({ error: "Slot not found" }, 404);

    // Update poll status
    await db
      .update(availabilityPolls)
      .set({
        status: "confirmed",
        confirmedSlotId: slot.id,
        updatedAt: new Date(),
      })
      .where(eq(availabilityPolls.id, poll.id));

    // Notify all participants
    const responses = await db
      .select()
      .from(pollResponses)
      .where(eq(pollResponses.pollId, poll.id));

    for (const resp of responses) {
      try {
        await _emailProvider.sendPollConfirmation({
          pollId: poll.id,
          recipientEmail: resp.participantEmail,
          recipientName: resp.participantName,
          pollTitle: poll.title,
          start: slot.startAt,
          end: slot.endAt,
          recipientTimezone: "UTC",
        });
      } catch (e) {
        console.error("Poll confirmation email failed:", e);
      }
    }

    return c.json({ confirmed: true, slotStart: slot.startAt.toISOString() });
  },
);

// ---------------------------------------------------------------------------
// Delete poll (auth, creator only)
// ---------------------------------------------------------------------------

polls.delete("/:shareToken", requireAuth, async (c) => {
  const shareToken = c.req.param("shareToken");
  if (!shareToken) return c.json({ error: "Not found" }, 404);

  const userId = c.get("userId");
  const db = getDb();

  const poll = first(
    await db
      .select()
      .from(availabilityPolls)
      .where(eq(availabilityPolls.shareToken, shareToken))
      .limit(1),
  );
  if (!poll || poll.creatorId !== userId) {
    return c.json({ error: "Not authorized" }, 403);
  }

  await db.delete(availabilityPolls).where(eq(availabilityPolls.id, poll.id));
  return c.json({ deleted: true });
});

export { polls as pollsRouter };
