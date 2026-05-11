/**
 * Email adapter.
 *
 * Supports two providers:
 *   - Resend: when RESEND_API_KEY is set
 *   - SMTP/nodemailer: when SMTP_HOST is set
 *
 * If neither is configured, logs a warning and skips sending (graceful no-op).
 * Email failure never throws — it logs and returns false.
 */

import { generateIcs, type IcsOptions } from "./ics";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  icsAttachment?: IcsOptions;
}

export interface EmailAdapter {
  sendEmail(opts: EmailOptions): Promise<boolean>;
}

// ── Resend adapter ──────────────────────────────────────────────────────────

class ResendAdapter implements EmailAdapter {
  constructor(private apiKey: string, private from: string) {}

  async sendEmail(opts: EmailOptions): Promise<boolean> {
    const attachments =
      opts.icsAttachment
        ? [
            {
              filename: "invite.ics",
              content: Buffer.from(generateIcs(opts.icsAttachment)).toString("base64"),
              type: "text/calendar; method=REQUEST",
              disposition: "attachment",
            },
          ]
        : undefined;

    const body: Record<string, unknown> = {
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    };
    if (attachments) body.attachments = attachments;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email:resend] send failed", res.status, text);
      return false;
    }
    return true;
  }
}

// ── SMTP adapter (nodemailer, lazy-loaded) ──────────────────────────────────

class SmtpAdapter implements EmailAdapter {
  private transport: unknown = null;

  constructor(
    private host: string,
    private port: number,
    private user: string,
    private pass: string,
    private from: string
  ) {}

  private async getTransport() {
    if (this.transport) return this.transport;
    // Dynamically import nodemailer — only loaded when SMTP_HOST is set.
    // Use Function constructor to prevent webpack from bundling it statically.
    let nodemailer: { default: { createTransport: (opts: unknown) => unknown } } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      nodemailer = await (new Function('m', 'return import(m)'))('nodemailer');
    } catch {
      console.error("[email:smtp] nodemailer not available — install it: npm i nodemailer");
      return null;
    }
    if (!nodemailer) return null;
    this.transport = nodemailer.default.createTransport({
      host: this.host,
      port: this.port,
      secure: this.port === 465,
      auth: { user: this.user, pass: this.pass },
    });
    return this.transport;
  }

  async sendEmail(opts: EmailOptions): Promise<boolean> {
    const transport = await this.getTransport();
    if (!transport) return false;

    const attachments = opts.icsAttachment
      ? [{ filename: "invite.ics", content: generateIcs(opts.icsAttachment), contentType: "text/calendar" }]
      : [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (transport as any).sendMail({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments,
      });
      return true;
    } catch (err) {
      console.error("[email:smtp] send failed", err);
      return false;
    }
  }
}

// ── No-op adapter ────────────────────────────────────────────────────────────

class NoopAdapter implements EmailAdapter {
  async sendEmail(opts: EmailOptions): Promise<boolean> {
    console.warn("[email:noop] No email provider configured. Would have sent:", opts.subject, "to", opts.to);
    return true; // Treat as success so booking still proceeds
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let _adapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (_adapter) return _adapter;

  const from = process.env.EMAIL_FROM ?? "booking@example.com";

  if (process.env.RESEND_API_KEY) {
    _adapter = new ResendAdapter(process.env.RESEND_API_KEY, from);
  } else if (process.env.SMTP_HOST) {
    _adapter = new SmtpAdapter(
      process.env.SMTP_HOST,
      parseInt(process.env.SMTP_PORT ?? "587"),
      process.env.SMTP_USER ?? "",
      process.env.SMTP_PASS ?? "",
      from
    );
  } else {
    _adapter = new NoopAdapter();
  }

  return _adapter;
}

// Reset adapter (used in tests)
export function resetEmailAdapter(): void {
  _adapter = null;
}

// ── Email templates ──────────────────────────────────────────────────────────

export interface BookingEmailData {
  bookingId: string;
  contactName: string;
  contactEmail: string;
  startUtc: string;
  endUtc: string;
  timezone: string;
  notes: string | null;
  cancelToken: string;
  rescheduleToken: string;
  adminName: string;
  adminEmail: string;
  baseUrl: string;
}

function formatDatetime(utcStr: string, tz: string): string {
  return new Date(utcStr).toLocaleString("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function gcalDeepLink(data: BookingEmailData): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `Meeting with ${data.adminName}`);
  const start = data.startUtc.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("Z", "Z");
  const end = data.endUtc.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("Z", "Z");
  url.searchParams.set("dates", `${start}/${end}`);
  return url.toString();
}

export async function sendGuestConfirmationEmail(data: BookingEmailData): Promise<boolean> {
  const adapter = getEmailAdapter();
  const localTime = formatDatetime(data.startUtc, data.timezone);
  const cancelLink = `${data.baseUrl}/api/bookings/${data.bookingId}/cancel?token=${data.cancelToken}`;
  const rescheduleLink = `${data.baseUrl}/reschedule/${data.rescheduleToken}`;
  const gcalLink = gcalDeepLink(data);

  const html = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>Your meeting is confirmed!</h2>
  <p>Hi ${escHtml(data.contactName)},</p>
  <p>Your meeting with <strong>${escHtml(data.adminName)}</strong> is confirmed.</p>
  <p><strong>${escHtml(localTime)}</strong></p>
  ${data.notes ? `<p><em>Notes: ${escHtml(data.notes)}</em></p>` : ""}
  <p>
    <a href="${gcalLink}">Add to Google Calendar</a>
  </p>
  <hr/>
  <p style="font-size:12px">
    <a href="${cancelLink}">Cancel this meeting</a> |
    <a href="${rescheduleLink}">Reschedule</a>
  </p>
</div>
  `.trim();

  const text = [
    `Your meeting is confirmed!`,
    ``,
    `Hi ${data.contactName},`,
    `Your meeting with ${data.adminName} is confirmed.`,
    ``,
    `When: ${localTime}`,
    data.notes ? `Notes: ${data.notes}` : "",
    ``,
    `Add to Google Calendar: ${gcalLink}`,
    ``,
    `Cancel: ${cancelLink}`,
    `Reschedule: ${rescheduleLink}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const icsData: IcsOptions = {
    bookingId: data.bookingId,
    summary: `Meeting with ${data.adminName}`,
    description: data.notes ?? "",
    start_utc: data.startUtc,
    end_utc: data.endUtc,
    organizerEmail: data.adminEmail,
    organizerName: data.adminName,
    attendeeEmail: data.contactEmail,
    attendeeName: data.contactName,
  };

  return adapter.sendEmail({
    to: data.contactEmail,
    subject: `Meeting confirmed — ${localTime}`,
    html,
    text,
    icsAttachment: icsData,
  });
}

export async function sendHostNotificationEmail(data: BookingEmailData): Promise<boolean> {
  const adapter = getEmailAdapter();
  const localTime = formatDatetime(data.startUtc, data.timezone);
  const cancelLink = `${data.baseUrl}/api/bookings/${data.bookingId}/cancel?token=${data.cancelToken}`;

  const html = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>New booking received</h2>
  <p><strong>Guest:</strong> ${escHtml(data.contactName)} &lt;${escHtml(data.contactEmail)}&gt;</p>
  <p><strong>When:</strong> ${escHtml(localTime)}</p>
  ${data.notes ? `<p><strong>Notes:</strong> ${escHtml(data.notes)}</p>` : ""}
  <hr/>
  <p style="font-size:12px"><a href="${cancelLink}">Cancel this booking</a></p>
</div>
  `.trim();

  const text = [
    `New booking received`,
    ``,
    `Guest: ${data.contactName} <${data.contactEmail}>`,
    `When: ${localTime}`,
    data.notes ? `Notes: ${data.notes}` : "",
    ``,
    `Cancel: ${cancelLink}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return adapter.sendEmail({
    to: data.adminEmail,
    subject: `New booking from ${data.contactName}`,
    html,
    text,
  });
}

export async function sendCancellationEmails(data: BookingEmailData): Promise<void> {
  const adapter = getEmailAdapter();
  const localTime = formatDatetime(data.startUtc, data.timezone);

  const guestHtml = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>Meeting cancelled</h2>
  <p>Hi ${escHtml(data.contactName)}, your meeting on ${escHtml(localTime)} has been cancelled.</p>
</div>`.trim();

  const hostHtml = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>Booking cancelled</h2>
  <p>The booking with ${escHtml(data.contactName)} on ${escHtml(localTime)} has been cancelled.</p>
</div>`.trim();

  await Promise.allSettled([
    adapter.sendEmail({
      to: data.contactEmail,
      subject: `Meeting cancelled — ${localTime}`,
      html: guestHtml,
      text: `Your meeting on ${localTime} has been cancelled.`,
    }),
    adapter.sendEmail({
      to: data.adminEmail,
      subject: `Booking cancelled — ${data.contactName}`,
      html: hostHtml,
      text: `The booking with ${data.contactName} on ${localTime} has been cancelled.`,
    }),
  ]);
}

export async function sendRescheduleConfirmationEmail(data: BookingEmailData): Promise<boolean> {
  const adapter = getEmailAdapter();
  const localTime = formatDatetime(data.startUtc, data.timezone);
  const cancelLink = `${data.baseUrl}/api/bookings/${data.bookingId}/cancel?token=${data.cancelToken}`;
  const rescheduleLink = `${data.baseUrl}/reschedule/${data.rescheduleToken}`;

  const html = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>Meeting rescheduled</h2>
  <p>Hi ${escHtml(data.contactName)}, your meeting has been rescheduled.</p>
  <p><strong>New time: ${escHtml(localTime)}</strong></p>
  <hr/>
  <p style="font-size:12px">
    <a href="${cancelLink}">Cancel</a> |
    <a href="${rescheduleLink}">Reschedule again</a>
  </p>
</div>`.trim();

  const icsData: IcsOptions = {
    bookingId: data.bookingId,
    summary: `Meeting with ${data.adminName}`,
    description: data.notes ?? "",
    start_utc: data.startUtc,
    end_utc: data.endUtc,
    organizerEmail: data.adminEmail,
    organizerName: data.adminName,
    attendeeEmail: data.contactEmail,
    attendeeName: data.contactName,
  };

  return adapter.sendEmail({
    to: data.contactEmail,
    subject: `Meeting rescheduled — ${localTime}`,
    html,
    text: `Your meeting has been rescheduled to ${localTime}.\nCancel: ${cancelLink}\nReschedule: ${rescheduleLink}`,
    icsAttachment: icsData,
  });
}

export async function sendReminderEmail(data: BookingEmailData, type: "24h" | "1h"): Promise<boolean> {
  const adapter = getEmailAdapter();
  const localTime = formatDatetime(data.startUtc, data.timezone);
  const label = type === "24h" ? "tomorrow" : "in 1 hour";

  const html = `
<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
  <h2>Reminder: meeting ${label}</h2>
  <p>Hi ${escHtml(data.contactName)}, just a reminder about your meeting ${label}.</p>
  <p><strong>${escHtml(localTime)}</strong></p>
</div>`.trim();

  return adapter.sendEmail({
    to: data.contactEmail,
    subject: `Reminder: meeting ${label} — ${localTime}`,
    html,
    text: `Reminder: your meeting is ${label} at ${localTime}.`,
  });
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
