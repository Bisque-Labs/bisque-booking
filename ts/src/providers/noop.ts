/**
 * No-op provider implementations for tests and local dev without credentials.
 * Mirrors app/services/noop_providers.py.
 *
 * These implementations log calls and return empty/placeholder values —
 * they never throw, making them safe for unit tests and CI.
 */

import type {
  CalendarProvider,
  CancellationOptions,
  ConfirmationToClientOptions,
  ConfirmationToConsultantOptions,
  EmailProvider,
  PollConfirmationOptions,
  PollInviteOptions,
  ReminderOptions,
  WebhookProvider,
} from "./types";

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export class NoopCalendarProvider implements CalendarProvider {
  async getFreeBusy(
    userId: number,
    start: Date,
    end: Date,
  ): Promise<Array<[Date, Date]>> {
    console.debug(
      `NoopCalendarProvider.getFreeBusy user=${userId} ${start.toISOString()}–${end.toISOString()}`,
    );
    return [];
  }

  async createEvent(
    userId: number,
    title: string,
    start: Date,
  ): Promise<string> {
    const eventId = `noop-${userId}-${Math.floor(start.getTime() / 1000)}`;
    console.info(
      `NoopCalendarProvider.createEvent id=${eventId} title=${JSON.stringify(title)}`,
    );
    return eventId;
  }

  async deleteEvent(userId: number, eventId: string): Promise<void> {
    console.info(`NoopCalendarProvider.deleteEvent id=${eventId}`);
  }

  async getMeetLink(_userId: number, _eventId: string): Promise<null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export class NoopEmailProvider implements EmailProvider {
  async sendConfirmationToClient(
    opts: ConfirmationToClientOptions,
  ): Promise<void> {
    console.info(
      `NoopEmail: confirmation → ${opts.clientEmail} (booking ${opts.bookingId})`,
    );
  }

  async sendConfirmationToConsultant(
    opts: ConfirmationToConsultantOptions,
  ): Promise<void> {
    console.info(
      `NoopEmail: consultant notification → ${opts.consultantEmail} (booking ${opts.bookingId})`,
    );
  }

  async sendReminder(opts: ReminderOptions): Promise<void> {
    console.info(
      `NoopEmail: reminder → ${opts.recipientEmail} (booking ${opts.bookingId})`,
    );
  }

  async sendCancellation(opts: CancellationOptions): Promise<void> {
    console.info(
      `NoopEmail: cancellation → ${opts.recipientEmail} (booking ${opts.bookingId})`,
    );
  }

  async sendPollInvite(opts: PollInviteOptions): Promise<void> {
    console.info(
      `NoopEmail: poll invite → ${opts.recipientEmail} (poll ${opts.pollId})`,
    );
  }

  async sendPollConfirmation(opts: PollConfirmationOptions): Promise<void> {
    console.info(
      `NoopEmail: poll confirmation → ${opts.recipientEmail} (poll ${opts.pollId})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export class NoopWebhookProvider implements WebhookProvider {
  async dispatch(event: string, _payload: Record<string, unknown>): Promise<void> {
    console.debug(`NoopWebhook: event=${event}`);
  }
}
