/**
 * ICS calendar file generation — pure functions, no I/O.
 * Mirrors app/services/ics.py.
 *
 * Uses ical-generator package to produce RFC 5545-compliant ICS files.
 */

import ical, { ICalCalendarMethod, ICalEventStatus } from "ical-generator";

/**
 * Generate an ICS file for a booking.
 * Returns the raw ICS content as a string (UTF-8 safe).
 */
export function generateIcs(opts: {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
  description?: string;
  location?: string;
}): string {
  const cal = ical({
    prodId: "-//bisque-booking//bisque-booking//EN",
    method: ICalCalendarMethod.REQUEST,
  });

  const eventData: Parameters<typeof cal.createEvent>[0] = {
    id: opts.uid,
    summary: opts.title,
    start: opts.start,
    end: opts.end,
    description: opts.description ?? "",
    organizer: {
      name: opts.organizerName,
      email: opts.organizerEmail,
    },
    attendees: [
      {
        name: opts.attendeeName,
        email: opts.attendeeEmail,
      },
    ],
  };
  if (opts.location) {
    eventData.location = opts.location;
  }
  cal.createEvent(eventData);

  return cal.toString();
}

/**
 * Generate a cancellation ICS (METHOD:CANCEL).
 */
export function generateCancellationIcs(opts: {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
}): string {
  const cal = ical({
    prodId: "-//bisque-booking//bisque-booking//EN",
    method: ICalCalendarMethod.CANCEL,
  });

  cal.createEvent({
    id: opts.uid,
    summary: `Cancelled: ${opts.title}`,
    start: opts.start,
    end: opts.end,
    status: ICalEventStatus.CANCELLED,
    organizer: {
      name: opts.organizerName,
      email: opts.organizerEmail,
    },
    attendees: [
      {
        name: opts.attendeeName,
        email: opts.attendeeEmail,
      },
    ],
  });

  return cal.toString();
}
