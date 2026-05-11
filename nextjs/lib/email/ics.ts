/**
 * ICS (iCalendar) file generator.
 *
 * Produces a minimal RFC 5545-compliant .ics attachment for a booking.
 */

function formatIcsDate(utcStr: string): string {
  // 20260101T120000Z
  return utcStr.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("Z", "Z");
}

export interface IcsOptions {
  bookingId: string;
  summary: string;
  description: string;
  start_utc: string;
  end_utc: string;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
  location?: string;
}

export function generateIcs(opts: IcsOptions): string {
  const now = formatIcsDate(new Date().toISOString());
  const start = formatIcsDate(opts.start_utc);
  const end = formatIcsDate(opts.end_utc);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//bisque-booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.bookingId}@bisque-booking`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${opts.summary}`,
    `DESCRIPTION:${opts.description.replace(/\n/g, "\\n")}`,
    opts.location ? `LOCATION:${opts.location}` : null,
    `ORGANIZER;CN=${opts.organizerName}:mailto:${opts.organizerEmail}`,
    `ATTENDEE;CN=${opts.attendeeName};RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return lines;
}
