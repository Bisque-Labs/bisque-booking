/**
 * Provider interface definitions — clean seams for external integrations.
 * Mirrors app/services/protocols.py.
 *
 * All concrete providers implement these interfaces so the core business logic
 * never depends on a specific implementation (Google, Outlook, SMTP, etc.).
 */

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarProvider {
  /**
   * Return a list of [start, end] busy intervals (UTC Date pairs) for the
   * given user within [start, end].
   */
  getFreeBusy(
    userId: number,
    start: Date,
    end: Date,
  ): Promise<Array<[Date, Date]>>;

  /**
   * Create a calendar event. Returns the provider-side event ID.
   */
  createEvent(
    userId: number,
    title: string,
    start: Date,
    end: Date,
    options?: {
      description?: string;
      attendeeEmail?: string;
      createMeetLink?: boolean;
    },
  ): Promise<string>;

  /**
   * Delete a calendar event by provider event ID.
   */
  deleteEvent(userId: number, eventId: string): Promise<void>;

  /**
   * Return the video conferencing link for an event, if any.
   */
  getMeetLink(userId: number, eventId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface ConfirmationToClientOptions {
  bookingId: number;
  clientEmail: string;
  clientName: string;
  consultantName: string;
  start: Date;
  end: Date;
  clientTimezone: string;
  cancelUrl: string;
  rescheduleUrl: string;
  videoLink?: string | null;
  icsContent?: Buffer | null;
}

export interface ConfirmationToConsultantOptions {
  bookingId: number;
  consultantEmail: string;
  consultantName: string;
  clientName: string;
  clientEmail: string;
  clientData: Record<string, unknown>;
  start: Date;
  end: Date;
  consultantTimezone: string;
  cancelUrl: string;
  icsContent?: Buffer | null;
}

export interface ReminderOptions {
  bookingId: number;
  recipientEmail: string;
  recipientName: string;
  start: Date;
  end: Date;
  recipientTimezone: string;
  videoLink?: string | null;
}

export interface CancellationOptions {
  bookingId: number;
  recipientEmail: string;
  recipientName: string;
  start: Date;
  end: Date;
  recipientTimezone: string;
  cancelledBy?: string;
}

export interface PollInviteOptions {
  pollId: number;
  recipientEmail: string;
  recipientName: string;
  pollTitle: string;
  pollUrl: string;
  expiresAt?: Date | null;
}

export interface PollConfirmationOptions {
  pollId: number;
  recipientEmail: string;
  recipientName: string;
  pollTitle: string;
  start: Date;
  end: Date;
  recipientTimezone: string;
  icsContent?: Buffer | null;
}

export interface EmailProvider {
  sendConfirmationToClient(opts: ConfirmationToClientOptions): Promise<void>;
  sendConfirmationToConsultant(
    opts: ConfirmationToConsultantOptions,
  ): Promise<void>;
  sendReminder(opts: ReminderOptions): Promise<void>;
  sendCancellation(opts: CancellationOptions): Promise<void>;
  sendPollInvite(opts: PollInviteOptions): Promise<void>;
  sendPollConfirmation(opts: PollConfirmationOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface WebhookProvider {
  /**
   * Fire a webhook event.
   * @param event   Event name, e.g. "booking.created", "booking.cancelled".
   * @param payload JSON-serialisable event payload.
   */
  dispatch(event: string, payload: Record<string, unknown>): Promise<void>;
}
