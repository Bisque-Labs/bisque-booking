/**
 * Drizzle ORM schema — all 7 tables ported from Python SQLAlchemy models.
 *
 * Tables:
 *   users, event_types, availability_rules, bookings,
 *   availability_polls, poll_slots, poll_responses
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["admin", "consultant"]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "rescheduled",
]);

export const pollStatusEnum = pgEnum("poll_status", [
  "open",
  "closed",
  "confirmed",
]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  role: userRoleEnum("role").notNull().default("consultant"),
  timezone: text("timezone").notNull().default("UTC"),

  // Auth
  hashedPassword: text("hashed_password"),
  googleId: text("google_id").unique(),
  googleCredentialsEncrypted: text("google_credentials_encrypted"),

  // Status
  isActive: boolean("is_active").notNull().default(true),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// event_types
// ---------------------------------------------------------------------------

export const eventTypes = pgTable(
  "event_types",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(1),
    maxHorizonDays: integer("max_horizon_days").notNull().default(30),
    color: text("color").notNull().default("#2563eb"),
    location: text("location"),
    videoLink: text("video_link"),
    // Custom intake questions: [{label, required, type}]
    intakeQuestions: json("intake_questions")
      .$type<Array<{ label: string; required: boolean; type: string }>>()
      .notNull()
      .default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userId, table.slug)],
);

export type EventType = typeof eventTypes.$inferSelect;
export type NewEventType = typeof eventTypes.$inferInsert;

// ---------------------------------------------------------------------------
// availability_rules
// ---------------------------------------------------------------------------

export const availabilityRules = pgTable("availability_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // 0 = Monday … 6 = Sunday (matches Python weekday())
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(), // "HH:MM:SS"
  endTime: time("end_time").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type NewAvailabilityRule = typeof availabilityRules.$inferInsert;

// ---------------------------------------------------------------------------
// bookings
// ---------------------------------------------------------------------------

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  eventTypeId: integer("event_type_id")
    .notNull()
    .references(() => eventTypes.id, { onDelete: "cascade" }),

  // Client info (no account required)
  clientEmail: text("client_email").notNull(),
  clientName: text("client_name").notNull(),
  clientTimezone: text("client_timezone").notNull().default("UTC"),
  // Intake form answers + extra client data
  clientData: json("client_data").$type<Record<string, unknown>>().notNull().default({}),

  // Timing (always UTC in DB)
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),

  status: bookingStatusEnum("status").notNull().default("confirmed"),

  // Google Calendar event ID for deletion on cancel
  googleEventId: text("google_event_id"),

  // Single-use tokens for client-facing actions
  cancelToken: text("cancel_token").notNull().unique(),
  rescheduleToken: text("reschedule_token").notNull().unique(),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// ---------------------------------------------------------------------------
// availability_polls
// ---------------------------------------------------------------------------

export const availabilityPolls = pgTable("availability_polls", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: pollStatusEnum("status").notNull().default("open"),
  shareToken: text("share_token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Set after a slot is confirmed
  confirmedSlotId: integer("confirmed_slot_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AvailabilityPoll = typeof availabilityPolls.$inferSelect;
export type NewAvailabilityPoll = typeof availabilityPolls.$inferInsert;

// ---------------------------------------------------------------------------
// poll_slots
// ---------------------------------------------------------------------------

export const pollSlots = pgTable("poll_slots", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id")
    .notNull()
    .references(() => availabilityPolls.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
});

export type PollSlot = typeof pollSlots.$inferSelect;
export type NewPollSlot = typeof pollSlots.$inferInsert;

// ---------------------------------------------------------------------------
// poll_responses
// ---------------------------------------------------------------------------

export const pollResponses = pgTable("poll_responses", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id")
    .notNull()
    .references(() => availabilityPolls.id, { onDelete: "cascade" }),
  participantEmail: text("participant_email").notNull(),
  participantName: text("participant_name").notNull(),
  // { slot_id: "yes" | "if_needed" | "no" }
  responses: json("responses")
    .$type<Record<string, "yes" | "if_needed" | "no">>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PollResponse = typeof pollResponses.$inferSelect;
export type NewPollResponse = typeof pollResponses.$inferInsert;

// ---------------------------------------------------------------------------
// Relations (for Drizzle query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  eventTypes: many(eventTypes),
  availabilityRules: many(availabilityRules),
  createdPolls: many(availabilityPolls),
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
  user: one(users, { fields: [eventTypes.userId], references: [users.id] }),
  bookings: many(bookings),
}));

export const availabilityRulesRelations = relations(
  availabilityRules,
  ({ one }) => ({
    user: one(users, {
      fields: [availabilityRules.userId],
      references: [users.id],
    }),
  }),
);

export const bookingsRelations = relations(bookings, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [bookings.eventTypeId],
    references: [eventTypes.id],
  }),
}));

export const availabilityPollsRelations = relations(
  availabilityPolls,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [availabilityPolls.creatorId],
      references: [users.id],
    }),
    slots: many(pollSlots),
    responses: many(pollResponses),
  }),
);

export const pollSlotsRelations = relations(pollSlots, ({ one }) => ({
  poll: one(availabilityPolls, {
    fields: [pollSlots.pollId],
    references: [availabilityPolls.id],
  }),
}));

export const pollResponsesRelations = relations(pollResponses, ({ one }) => ({
  poll: one(availabilityPolls, {
    fields: [pollResponses.pollId],
    references: [availabilityPolls.id],
  }),
}));
