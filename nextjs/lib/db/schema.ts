/**
 * bisque-booking database schema types.
 *
 * All times are stored as UTC ISO-8601 strings.
 * The SQLite tables are created by lib/db/migrate.ts on startup.
 */

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "rescheduled";

export interface Booking {
  id: string;
  contact_name: string;
  contact_email: string;
  start_utc: string;
  end_utc: string;
  timezone: string;
  notes: string | null;
  status: BookingStatus;
  cancel_token: string;
  reschedule_token: string;
  remind_24h_sent: number; // 0 | 1 (SQLite boolean)
  remind_1h_sent: number;  // 0 | 1
  created_at: string;
}

export interface AvailabilityWindow {
  id: number;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_time: string;  // "HH:MM" in timezone
  end_time: string;    // "HH:MM" in timezone
  timezone: string;
}

export interface BlockedDate {
  id: number;
  start_date: string; // "YYYY-MM-DD"
  end_date: string;   // "YYYY-MM-DD"
  reason: string | null;
}

export interface BookingConfig {
  id: number;
  buffer_minutes: number;
  max_bookings_per_day: number;
  slot_duration_minutes: number;
  admin_timezone: string;
  admin_email: string;
  admin_name: string;
  google_credentials_encrypted: string | null;
  updated_at: string;
}

/** Typed slot returned by the slot engine */
export interface AvailableSlot {
  start_utc: string;
  end_utc: string;
  start_local: string; // formatted in requested timezone
  end_local: string;
}

/** BookingConfirmed event emitted after a booking is created */
export interface BookingConfirmed {
  booking_id: string;
  contact_email: string;
  contact_name: string;
  start_utc: string;
  end_utc: string;
  notes: string | null;
}

/** BookingCancelled event emitted when a booking is cancelled */
export interface BookingCancelled {
  booking_id: string;
  contact_email: string;
}

/** Adapter interface — any integration implements this */
export interface BookingAdapter {
  onBookingConfirmed?(event: BookingConfirmed): Promise<void>;
  onBookingCancelled?(event: BookingCancelled): Promise<void>;
}
