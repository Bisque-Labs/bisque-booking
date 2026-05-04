/**
 * Availability slot computation — pure functional, no I/O.
 *
 * Exact TypeScript port of app/services/availability.py.
 *
 * Given a user's availability rules, busy intervals from a calendar provider,
 * and event type configuration, compute the list of bookable slots for a date
 * or date range.
 *
 * All datetimes are timezone-aware (JavaScript Date objects are always UTC
 * internally; we use Intl.DateTimeFormat for timezone-aware local time).
 *
 * Slot generation is intentionally pure (no I/O) so it's trivially unit-testable.
 */

import type { AvailabilityRule } from "@/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal EventType fields needed by the slot engine. */
export interface SlotEventType {
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxHorizonDays: number;
}

/** A busy interval — [start, end] in UTC (as Date objects). */
export type BusyInterval = [Date, Date];

/** A calendar date represented as { year, month, day } (month is 1-based). */
export interface CalendarDate {
  year: number;
  month: number; // 1-based
  day: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM:SS" or "HH:MM" time string into { hours, minutes, seconds }. */
function parseTimeString(t: string): { hours: number; minutes: number; seconds: number } {
  const parts = t.split(":").map(Number);
  return {
    hours: parts[0] ?? 0,
    minutes: parts[1] ?? 0,
    seconds: parts[2] ?? 0,
  };
}

/**
 * Compute the local date for a UTC Date in the given IANA timezone.
 * Returns { year, month (1-based), day, hour, minute }.
 */
function toLocalParts(
  utcDate: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/**
 * Get the ISO weekday (0=Monday … 6=Sunday) for a date in a specific timezone.
 * Matches Python's date.weekday().
 */
function weekdayInTz(utcDate: Date, timeZone: string): number {
  const local = toLocalParts(utcDate, timeZone);
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day));
  // getUTCDay: 0=Sunday, 1=Monday … 6=Saturday → convert to Python convention
  return (d.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
}

/**
 * Get the ISO weekday (0=Monday … 6=Sunday) for a CalendarDate.
 * Uses UTC Date.
 */
function calendarDateWeekday(d: CalendarDate): number {
  const jsDate = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return (jsDate.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
}

/**
 * Build a UTC Date from a CalendarDate + HH:MM:SS time string in a given timezone.
 *
 * Strategy: construct the local ISO datetime string and parse as if UTC,
 * then adjust. Actually the cleanest approach is to use the offset trick:
 * find the UTC ms value such that when interpreted in `timeZone`, it gives
 * exactly `calDate` at `timeStr`.
 *
 * We use a binary-search-free approach: format a candidate UTC time and check
 * the local interpretation. Because DST offsets are at most ±14h, we can
 * solve this directly.
 */
function localDateTimeToUtc(
  calDate: CalendarDate,
  timeStr: string,
  timeZone: string,
): Date {
  const { hours, minutes, seconds } = parseTimeString(timeStr);

  // Construct a candidate UTC date where we ignore timezone offset
  const naiveMs = Date.UTC(
    calDate.year,
    calDate.month - 1,
    calDate.day,
    hours,
    minutes,
    seconds,
  );

  // Find the UTC offset for this local time in the given timezone.
  // We do this by checking what local time our candidate UTC corresponds to.
  const candidate = new Date(naiveMs);
  const local = toLocalParts(candidate, timeZone);

  // Difference between intended local time and what we got (in minutes)
  const intendedMinutes = hours * 60 + minutes;
  const actualMinutes = local.hour * 60 + local.minute;
  const diffMs = (intendedMinutes - actualMinutes) * 60 * 1000;

  return new Date(naiveMs + diffMs);
}

// ---------------------------------------------------------------------------
// Core algorithm — mirrors availability.py exactly
// ---------------------------------------------------------------------------

/**
 * Return True if [slotStart, slotEnd) overlaps any busy interval.
 * Mirrors Python _overlaps_any_busy.
 */
export function overlapsAnyBusy(
  slotStart: Date,
  slotEnd: Date,
  busyIntervals: BusyInterval[],
): boolean {
  for (const [busyStart, busyEnd] of busyIntervals) {
    if (slotStart < busyEnd && slotEnd > busyStart) {
      return true;
    }
  }
  return false;
}

/**
 * Return a list of available slot start times (as UTC Dates) for targetDate.
 *
 * Exact port of generate_slots_for_date from availability.py:
 * - 15-minute slot grid
 * - Buffer time applied to slot end before checking busy intervals
 * - Min notice and max horizon filtering
 * - Slots sorted chronologically
 *
 * @param targetDate  CalendarDate to compute slots for
 * @param rules       User's AvailabilityRule records from DB
 * @param busyIntervals  [start, end] UTC Date pairs from calendar provider
 * @param eventType   EventType configuration (duration, buffer, notice, horizon)
 * @param userTimezone  IANA timezone string for the consultant
 * @param nowUtc      Current UTC time (injectable for testing)
 */
export function generateSlotsForDate(
  targetDate: CalendarDate,
  rules: Pick<AvailabilityRule, "dayOfWeek" | "startTime" | "endTime" | "timezone">[],
  busyIntervals: BusyInterval[],
  eventType: SlotEventType,
  userTimezone: string,
  nowUtc: Date = new Date(),
): Date[] {
  const dayOfWeek = calendarDateWeekday(targetDate);

  // Find rules matching this day of week
  const matchingRules = rules.filter((r) => r.dayOfWeek === dayOfWeek);
  if (matchingRules.length === 0) return [];

  const minNoticeMs = eventType.minNoticeHours * 60 * 60 * 1000;
  const maxHorizonMs = eventType.maxHorizonDays * 24 * 60 * 60 * 1000;
  const minStart = new Date(nowUtc.getTime() + minNoticeMs);
  const maxStart = new Date(nowUtc.getTime() + maxHorizonMs);

  const slotDurationMs = eventType.durationMinutes * 60 * 1000;
  const bufferMs = eventType.bufferMinutes * 60 * 1000;
  const stepMs = slotDurationMs + bufferMs;
  const gridStepMs = 15 * 60 * 1000; // 15-minute grid

  const slots: Date[] = [];

  for (const rule of matchingRules) {
    const ruleTz = rule.timezone;

    // Build window start/end as UTC dates from the rule's timezone
    const windowStartUtc = localDateTimeToUtc(targetDate, rule.startTime, ruleTz);
    const windowEndUtc = localDateTimeToUtc(targetDate, rule.endTime, ruleTz);

    let candidate = windowStartUtc;

    while (candidate.getTime() + slotDurationMs <= windowEndUtc.getTime()) {
      const slotEnd = new Date(candidate.getTime() + slotDurationMs);
      const slotEndWithBuffer = new Date(candidate.getTime() + stepMs);

      // Min notice / max horizon checks
      if (candidate < minStart || candidate > maxStart) {
        candidate = new Date(candidate.getTime() + gridStepMs);
        continue;
      }

      // Check against every busy interval
      if (!overlapsAnyBusy(candidate, slotEndWithBuffer, busyIntervals)) {
        slots.push(new Date(candidate));
      }

      candidate = new Date(candidate.getTime() + gridStepMs);
    }
  }

  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots;
}

/**
 * Return CalendarDates in [startDate, endDate] that have at least one bookable slot.
 * Mirrors Python get_available_dates.
 */
export function getAvailableDates(
  startDate: CalendarDate,
  endDate: CalendarDate,
  rules: Pick<AvailabilityRule, "dayOfWeek" | "startTime" | "endTime" | "timezone">[],
  busyIntervals: BusyInterval[],
  eventType: SlotEventType,
  userTimezone: string,
  nowUtc: Date = new Date(),
): CalendarDate[] {
  const available: CalendarDate[] = [];

  let current = new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day));
  const end = new Date(Date.UTC(endDate.year, endDate.month - 1, endDate.day));

  while (current <= end) {
    const calDate: CalendarDate = {
      year: current.getUTCFullYear(),
      month: current.getUTCMonth() + 1,
      day: current.getUTCDate(),
    };
    const slots = generateSlotsForDate(
      calDate,
      rules,
      busyIntervals,
      eventType,
      userTimezone,
      nowUtc,
    );
    if (slots.length > 0) {
      available.push(calDate);
    }
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  return available;
}

/**
 * Return a warning message if the slot is outside business hours in either timezone.
 * Mirrors Python detect_timezone_warning.
 *
 * @param slotStart    Booking start (UTC Date)
 * @param slotEnd      Booking end (UTC Date)
 * @param consultantTz Consultant's IANA timezone
 * @param clientTz     Client's IANA timezone
 * @param earlyHour    Hour below which a warning fires (default 8)
 * @param lateHour     Hour at/above which a warning fires (default 19)
 */
export function detectTimezoneWarning(
  slotStart: Date,
  slotEnd: Date,
  consultantTz: string,
  clientTz: string,
  earlyHour: number = 8,
  lateHour: number = 19,
): string | null {
  const warnings: string[] = [];

  for (const [label, tz] of [
    ["your consultant", consultantTz],
    ["you", clientTz],
  ] as const) {
    const localStart = toLocalParts(slotStart, tz);

    if (localStart.hour < earlyHour || localStart.hour >= lateHour) {
      const h = localStart.hour;
      const m = localStart.minute;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      const mStr = String(m).padStart(2, "0");
      warnings.push(
        `Note: this slot starts at ${h12}:${mStr} ${ampm} for ${label} in ${tz}.`,
      );
    }
  }

  return warnings.length > 0 ? warnings.join(" ") : null;
}
