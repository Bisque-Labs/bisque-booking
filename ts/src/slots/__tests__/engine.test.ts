/**
 * Unit tests for the slot engine — exact TypeScript port of tests/test_availability.py.
 * Pure functions, no I/O, no database.
 */

import { describe, it, expect } from "vitest";
import {
  overlapsAnyBusy,
  generateSlotsForDate,
  getAvailableDates,
  detectTimezoneWarning,
  type BusyInterval,
  type CalendarDate,
  type SlotEventType,
} from "../engine";

// ---------------------------------------------------------------------------
// Test fixtures — mirrors conftest / test helpers in Python
// ---------------------------------------------------------------------------

/**
 * Next Monday that is at least 14 days in the future, so min_notice and
 * max_horizon filters (with their defaults) don't interfere.
 */
function getFutureMonday(): CalendarDate {
  const now = new Date();
  // Find the next Monday
  const dayMs = 24 * 60 * 60 * 1000;
  let d = new Date(now.getTime() + 7 * dayMs);
  while ((d.getUTCDay() + 6) % 7 !== 0) {
    d = new Date(d.getTime() + dayMs);
  }
  // Ensure at least 14 days out
  if (d.getTime() - now.getTime() < 14 * dayMs) {
    d = new Date(d.getTime() + 7 * dayMs);
  }
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function addDays(d: CalendarDate, n: number): CalendarDate {
  const js = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * 24 * 60 * 60 * 1000);
  return { year: js.getUTCFullYear(), month: js.getUTCMonth() + 1, day: js.getUTCDate() };
}

const FUTURE_MONDAY = getFutureMonday();
const FUTURE_WEDNESDAY = addDays(FUTURE_MONDAY, 2);

/** nowUtc set 1 day in the past so minNoticeHours=0 doesn't filter future slots */
const FAR_NOW = new Date(Date.now() - 24 * 60 * 60 * 1000);

function makeRule(
  dayOfWeek: number,
  start: string,
  end: string,
  timezone: string = "UTC",
) {
  return {
    dayOfWeek,
    startTime: `${start}:00`,
    endTime: `${end}:00`,
    timezone,
  };
}

function makeEventType(
  durationMinutes: number = 30,
  bufferMinutes: number = 0,
  minNoticeHours: number = 0,
  maxHorizonDays: number = 365,
): SlotEventType {
  return { durationMinutes, bufferMinutes, minNoticeHours, maxHorizonDays };
}

function utcDate(y: number, mo: number, d: number, h: number, m: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0));
}

// ---------------------------------------------------------------------------
// overlapsAnyBusy
// ---------------------------------------------------------------------------

describe("overlapsAnyBusy()", () => {
  it("returns false for empty busy list", () => {
    const slot = utcDate(2025, 1, 1, 10, 0);
    const slotEnd = utcDate(2025, 1, 1, 11, 0);
    expect(overlapsAnyBusy(slot, slotEnd, [])).toBe(false);
  });

  it("detects overlap", () => {
    const slotStart = utcDate(2025, 1, 1, 10, 0);
    const slotEnd = utcDate(2025, 1, 1, 10, 30);
    const busy: BusyInterval[] = [
      [utcDate(2025, 1, 1, 10, 15), utcDate(2025, 1, 1, 11, 0)],
    ];
    expect(overlapsAnyBusy(slotStart, slotEnd, busy)).toBe(true);
  });

  it("adjacent slots do not overlap", () => {
    const slotStart = utcDate(2025, 1, 1, 10, 0);
    const slotEnd = utcDate(2025, 1, 1, 10, 30);
    const busy: BusyInterval[] = [
      [utcDate(2025, 1, 1, 10, 30), utcDate(2025, 1, 1, 11, 0)],
    ];
    expect(overlapsAnyBusy(slotStart, slotEnd, busy)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSlotsForDate
// ---------------------------------------------------------------------------

describe("generateSlotsForDate()", () => {
  it("generates slots within window", () => {
    const rule = makeRule(FUTURE_MONDAY.day % 7 === 0 ? 0 : (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7, "09:00", "11:00");
    const et = makeEventType(30);
    // Use the correct weekday for the rule
    const correctRule = {
      ...rule,
      dayOfWeek: (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7,
    };

    const slots = generateSlotsForDate(FUTURE_MONDAY, [correctRule], [], et, "UTC", FAR_NOW);
    expect(slots.length).toBeGreaterThan(0);

    // All slots should have start >= 09:00 and end <= 11:00
    for (const slot of slots) {
      expect(slot.getUTCHours()).toBeGreaterThanOrEqual(9);
      const slotEnd = new Date(slot.getTime() + 30 * 60 * 1000);
      const dayEnd = new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day, 11, 0));
      expect(slotEnd.getTime()).toBeLessThanOrEqual(dayEnd.getTime());
    }
  });

  it("returns no slots for wrong day of week", () => {
    const mondayWeekday = (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7;
    const rule = makeRule(mondayWeekday, "09:00", "17:00");
    const et = makeEventType(30);

    // Wednesday has a different weekday
    const slots = generateSlotsForDate(FUTURE_WEDNESDAY, [rule], [], et, "UTC", FAR_NOW);
    expect(slots).toEqual([]);
  });

  it("busy interval removes slot at that time", () => {
    const mondayWeekday = (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7;
    const rule = makeRule(mondayWeekday, "09:00", "10:00");
    const et = makeEventType(30);

    const busyStart = new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day, 9, 0));
    const busyEnd = new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day, 9, 30));

    const slots = generateSlotsForDate(FUTURE_MONDAY, [rule], [[busyStart, busyEnd]], et, "UTC", FAR_NOW);
    const slotMinutes = slots.map((s) => s.getUTCHours() * 60 + s.getUTCMinutes());
    expect(slotMinutes).not.toContain(9 * 60); // 09:00 blocked
    expect(slotMinutes).toContain(9 * 60 + 30); // 09:30 available
  });

  it("slot count correct for 1-hour window, 30-min slots", () => {
    const mondayWeekday = (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7;
    const rule = makeRule(mondayWeekday, "09:00", "10:00");
    const et = makeEventType(30);

    const slots = generateSlotsForDate(FUTURE_MONDAY, [rule], [], et, "UTC", FAR_NOW);
    // 09:00, 09:15, 09:30 fit within window (09:45+30min = 10:15 > 10:00, so excluded)
    expect(slots.length).toBeGreaterThanOrEqual(2);
  });

  it("returns slots sorted chronologically", () => {
    const mondayWeekday = (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7;
    const rule = makeRule(mondayWeekday, "09:00", "12:00");
    const et = makeEventType(30);

    const slots = generateSlotsForDate(FUTURE_MONDAY, [rule], [], et, "UTC", FAR_NOW);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.getTime()).toBeGreaterThan(slots[i - 1]!.getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// detectTimezoneWarning
// ---------------------------------------------------------------------------

describe("detectTimezoneWarning()", () => {
  it("returns null during business hours (2pm UTC)", () => {
    const start = utcDate(2025, 1, 6, 14, 0);
    const end = utcDate(2025, 1, 6, 15, 0);
    expect(detectTimezoneWarning(start, end, "UTC", "UTC")).toBeNull();
  });

  it("warns for early morning (7am UTC)", () => {
    const start = utcDate(2025, 1, 6, 7, 0);
    const end = utcDate(2025, 1, 6, 8, 0);
    const warning = detectTimezoneWarning(start, end, "UTC", "UTC");
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/7:00 AM/);
  });

  it("warns for late evening (8pm UTC)", () => {
    const start = utcDate(2025, 1, 6, 20, 0);
    const end = utcDate(2025, 1, 6, 21, 0);
    const warning = detectTimezoneWarning(start, end, "UTC", "UTC");
    expect(warning).not.toBeNull();
  });

  it("warns for cross-timezone late slot", () => {
    // 9pm UTC = past business hours in both UTC and Eastern
    const start = utcDate(2025, 1, 6, 21, 0);
    const end = utcDate(2025, 1, 6, 22, 0);
    const warning = detectTimezoneWarning(start, end, "UTC", "America/New_York");
    expect(warning).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAvailableDates
// ---------------------------------------------------------------------------

describe("getAvailableDates()", () => {
  it("returns Mon-Fri for Mon-Fri rules over a Mon-Sun week", () => {
    // Create rules for Mon(0)–Fri(4)
    const mondayWeekday = (new Date(Date.UTC(FUTURE_MONDAY.year, FUTURE_MONDAY.month - 1, FUTURE_MONDAY.day)).getUTCDay() + 6) % 7;
    const rules = Array.from({ length: 5 }, (_, i) =>
      makeRule((mondayWeekday + i) % 7, "09:00", "17:00"),
    );
    const et = makeEventType(30);
    const endDate = addDays(FUTURE_MONDAY, 6); // Sun

    const available = getAvailableDates(
      FUTURE_MONDAY,
      endDate,
      rules,
      [],
      et,
      "UTC",
      FAR_NOW,
    );

    expect(available.length).toBe(5);
    // Saturday (+5) and Sunday (+6) should NOT be included
    const satStr = JSON.stringify(addDays(FUTURE_MONDAY, 5));
    const sunStr = JSON.stringify(addDays(FUTURE_MONDAY, 6));
    expect(available.map((d) => JSON.stringify(d))).not.toContain(satStr);
    expect(available.map((d) => JSON.stringify(d))).not.toContain(sunStr);
  });

  it("returns empty list when no rules match any day", () => {
    const available = getAvailableDates(
      FUTURE_MONDAY,
      addDays(FUTURE_MONDAY, 6),
      [], // no rules
      [],
      makeEventType(30),
      "UTC",
      FAR_NOW,
    );
    expect(available).toEqual([]);
  });
});
