/**
 * Slot engine — generates available booking slots for a given date.
 *
 * Algorithm:
 *   1. Load availability windows for the requested day-of-week
 *   2. Expand into candidate slots of slot_duration_minutes
 *   3. Remove slots that overlap with existing confirmed bookings (+ buffer)
 *   4. Remove slots that fall in blocked date ranges
 *   5. Remove slots in the past
 *   6. Return the remaining slots in the requested timezone
 */

import type Database from "better-sqlite3";
import type { AvailabilityWindow, Booking, BlockedDate, BookingConfig, AvailableSlot } from "@/lib/db/schema";

interface SlotEngineOptions {
  date: string;       // "YYYY-MM-DD" in the visitor's timezone
  timezone: string;   // IANA timezone string
}

/**
 * Parse "HH:MM" and combine with a Date to get a UTC timestamp.
 * The time is interpreted in `timezone`.
 */
function parseLocalTime(date: string, time: string, timezone: string): Date {
  // Use Intl to handle timezone conversion
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  // Create date in UTC then adjust for timezone
  // We use a trick: format a UTC date and compare to what local time would be
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Get the offset for this timezone at this point in time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Binary search for the correct UTC time that corresponds to local time
  // Start with a rough estimate
  const parts = formatter.formatToParts(utcDate);
  const localHour = parseInt(parts.find(p => p.type === "hour")!.value);
  const localMinute = parseInt(parts.find(p => p.type === "minute")!.value);
  const localDay = parseInt(parts.find(p => p.type === "day")!.value);

  // Calculate offset in minutes
  const expectedMinutes = hour * 60 + minute;
  const actualMinutes = localHour * 60 + localMinute;
  const dayDiff = (localDay - day) * 24 * 60;

  let offsetMinutes = actualMinutes - expectedMinutes + dayDiff;
  // Handle edge cases for large offsets
  if (offsetMinutes > 12 * 60) offsetMinutes -= 24 * 60;
  if (offsetMinutes < -12 * 60) offsetMinutes += 24 * 60;

  return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
}

function formatInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function generateSlots(db: Database.Database, options: SlotEngineOptions): AvailableSlot[] {
  const { date, timezone } = options;

  // Determine day of week for the requested date (in the visitor's timezone)
  const [year, month, day] = date.split("-").map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // noon UTC as proxy
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(localDate);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[dayOfWeek];

  // Load config
  const config = db.prepare("SELECT * FROM booking_config WHERE id = 1").get() as BookingConfig | undefined;
  if (!config) return [];

  const bufferMs = config.buffer_minutes * 60 * 1000;
  const slotMs = config.slot_duration_minutes * 60 * 1000;

  // Load availability windows for this day
  const windows = db
    .prepare("SELECT * FROM availability_windows WHERE day_of_week = ?")
    .all(dow) as AvailabilityWindow[];

  if (windows.length === 0) return [];

  // Check if date is blocked
  const blocked = db
    .prepare("SELECT * FROM blocked_dates WHERE start_date <= ? AND end_date >= ?")
    .all(date, date) as BlockedDate[];
  if (blocked.length > 0) return [];

  // Load existing confirmed bookings for this date (approximate — within ±1 day)
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
  const dayEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0)).toISOString();
  const existingBookings = db
    .prepare("SELECT * FROM bookings WHERE status IN ('confirmed','pending') AND start_utc < ? AND end_utc > ?")
    .all(dayEnd, dayStart) as Booking[];

  const now = Date.now();
  const slots: AvailableSlot[] = [];

  for (const window of windows) {
    // Use admin timezone for window times (stored in window.timezone)
    const windowTz = window.timezone || config.admin_timezone || "UTC";
    const windowStart = parseLocalTime(date, window.start_time, windowTz);
    const windowEnd = parseLocalTime(date, window.end_time, windowTz);

    let cursor = windowStart.getTime();
    const windowEndMs = windowEnd.getTime();

    while (cursor + slotMs <= windowEndMs) {
      const slotStart = cursor;
      const slotEnd = cursor + slotMs;

      // Skip past slots
      if (slotEnd <= now) {
        cursor += slotMs;
        continue;
      }

      // Check overlap with existing bookings (including buffer)
      const overlaps = existingBookings.some((b) => {
        const bStart = new Date(b.start_utc).getTime() - bufferMs;
        const bEnd = new Date(b.end_utc).getTime() + bufferMs;
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!overlaps) {
        slots.push({
          start_utc: new Date(slotStart).toISOString(),
          end_utc: new Date(slotEnd).toISOString(),
          start_local: formatInTimezone(new Date(slotStart), timezone),
          end_local: formatInTimezone(new Date(slotEnd), timezone),
        });
      }

      cursor += slotMs;
    }
  }

  return slots;
}
