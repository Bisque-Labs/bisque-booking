/**
 * Unit tests for the Drizzle schema definitions.
 *
 * These tests verify the shape and metadata of the schema without hitting
 * a real database — they import the table objects and inspect their columns.
 */

import { describe, it, expect } from "vitest";
import {
  users,
  eventTypes,
  availabilityRules,
  bookings,
  availabilityPolls,
  pollSlots,
  pollResponses,
  userRoleEnum,
  bookingStatusEnum,
  pollStatusEnum,
} from "../schema";

describe("Enum definitions", () => {
  it("userRoleEnum has admin and consultant", () => {
    expect(userRoleEnum.enumValues).toEqual(["admin", "consultant"]);
  });

  it("bookingStatusEnum has correct values", () => {
    expect(bookingStatusEnum.enumValues).toEqual([
      "pending",
      "confirmed",
      "cancelled",
      "rescheduled",
    ]);
  });

  it("pollStatusEnum has correct values", () => {
    expect(pollStatusEnum.enumValues).toEqual(["open", "closed", "confirmed"]);
  });
});

describe("users table", () => {
  it("has expected columns", () => {
    const cols = Object.keys(users);
    expect(cols).toContain("id");
    expect(cols).toContain("email");
    expect(cols).toContain("name");
    expect(cols).toContain("slug");
    expect(cols).toContain("role");
    expect(cols).toContain("timezone");
    expect(cols).toContain("hashedPassword");
    expect(cols).toContain("googleId");
    expect(cols).toContain("isActive");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });
});

describe("eventTypes table", () => {
  it("has expected columns", () => {
    const cols = Object.keys(eventTypes);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("slug");
    expect(cols).toContain("title");
    expect(cols).toContain("durationMinutes");
    expect(cols).toContain("bufferMinutes");
    expect(cols).toContain("minNoticeHours");
    expect(cols).toContain("maxHorizonDays");
    expect(cols).toContain("intakeQuestions");
    expect(cols).toContain("isActive");
  });
});

describe("availabilityRules table", () => {
  it("has dayOfWeek, startTime, endTime columns", () => {
    const cols = Object.keys(availabilityRules);
    expect(cols).toContain("dayOfWeek");
    expect(cols).toContain("startTime");
    expect(cols).toContain("endTime");
    expect(cols).toContain("timezone");
  });
});

describe("bookings table", () => {
  it("has client, timing, and token columns", () => {
    const cols = Object.keys(bookings);
    expect(cols).toContain("eventTypeId");
    expect(cols).toContain("clientEmail");
    expect(cols).toContain("clientName");
    expect(cols).toContain("clientTimezone");
    expect(cols).toContain("clientData");
    expect(cols).toContain("startAt");
    expect(cols).toContain("endAt");
    expect(cols).toContain("status");
    expect(cols).toContain("cancelToken");
    expect(cols).toContain("rescheduleToken");
    expect(cols).toContain("googleEventId");
  });
});

describe("availabilityPolls table", () => {
  it("has poll-specific columns", () => {
    const cols = Object.keys(availabilityPolls);
    expect(cols).toContain("creatorId");
    expect(cols).toContain("title");
    expect(cols).toContain("status");
    expect(cols).toContain("shareToken");
    expect(cols).toContain("expiresAt");
    expect(cols).toContain("confirmedSlotId");
  });
});

describe("pollSlots table", () => {
  it("has pollId, startAt, endAt", () => {
    const cols = Object.keys(pollSlots);
    expect(cols).toContain("pollId");
    expect(cols).toContain("startAt");
    expect(cols).toContain("endAt");
  });
});

describe("pollResponses table", () => {
  it("has participant and responses columns", () => {
    const cols = Object.keys(pollResponses);
    expect(cols).toContain("pollId");
    expect(cols).toContain("participantEmail");
    expect(cols).toContain("participantName");
    expect(cols).toContain("responses");
  });
});
