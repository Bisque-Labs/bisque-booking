/**
 * SMTP email provider — sends transactional emails via nodemailer-style SMTP.
 *
 * Uses Node's built-in net/tls modules directly to avoid heavy dependencies.
 * For simplicity we use the `node:net` / `node:tls` SMTP client wrapper
 * that Node 18+ ships with. In production this can be swapped for a proper
 * SMTP library.
 *
 * Layer 5: this is the concrete EmailProvider implementation.
 * The NoopEmailProvider (Layer 1) is used in tests.
 */

import type {
  EmailProvider,
  ConfirmationToClientOptions,
  ConfirmationToConsultantOptions,
  ReminderOptions,
  CancellationOptions,
  PollInviteOptions,
  PollConfirmationOptions,
} from "./types";
import { getConfig } from "@/config";

// ---------------------------------------------------------------------------
// Minimal SMTP send using Node's built-in fetch/network
// ---------------------------------------------------------------------------

/** A single email attachment. */
interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** Minimal email message structure. */
interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

/** Build a MailMessage, omitting attachments if not provided. */
function buildMessage(
  base: Omit<MailMessage, "attachments">,
  icsContent: Buffer | null | undefined,
): MailMessage {
  if (!icsContent) return base;
  return {
    ...base,
    attachments: [{ filename: "invite.ics", content: icsContent, contentType: "text/calendar" }],
  };
}

/**
 * Send an email via SMTP using the configured SMTP settings.
 * This is a thin wrapper — in production, replace with nodemailer or postmark.
 */
async function sendMail(msg: MailMessage): Promise<void> {
  const cfg = getConfig();

  if (!cfg.SMTP_HOST || cfg.SMTP_HOST === "localhost") {
    // Dev/test mode — log instead of sending
    console.info(
      `[SMTP] Would send email to ${msg.to}: ${msg.subject}`,
    );
    return;
  }

  // Dynamic import nodemailer if available (optional dependency)
  try {
    const nodemailer = await import("nodemailer" as string);
    const transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_USE_TLS,
      auth:
        cfg.SMTP_USERNAME && cfg.SMTP_PASSWORD
          ? { user: cfg.SMTP_USERNAME, pass: cfg.SMTP_PASSWORD }
          : undefined,
    });

    await transporter.sendMail({
      from: `"bisque-booking" <${cfg.FROM_EMAIL}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  } catch (e) {
    console.error("[SMTP] Failed to send email:", e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// SMTP EmailProvider implementation
// ---------------------------------------------------------------------------

export class SmtpEmailProvider implements EmailProvider {
  async sendConfirmationToClient(opts: ConfirmationToClientOptions): Promise<void> {
    const localTime = opts.start.toLocaleString("en-US", {
      timeZone: opts.clientTimezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    await sendMail(buildMessage({
      from: getConfig().FROM_EMAIL,
      to: opts.clientEmail,
      subject: `Booking confirmed with ${opts.consultantName}`,
      text: [
        `Hi ${opts.clientName},`,
        "",
        `Your booking with ${opts.consultantName} is confirmed.`,
        "",
        `When: ${localTime} (${opts.clientTimezone})`,
        opts.videoLink ? `Video link: ${opts.videoLink}` : "",
        "",
        `Cancel: ${opts.cancelUrl}`,
        `Reschedule: ${opts.rescheduleUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    }, opts.icsContent));
  }

  async sendConfirmationToConsultant(
    opts: ConfirmationToConsultantOptions,
  ): Promise<void> {
    const localTime = opts.start.toLocaleString("en-US", {
      timeZone: opts.consultantTimezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    await sendMail(buildMessage({
      from: getConfig().FROM_EMAIL,
      to: opts.consultantEmail,
      subject: `New booking from ${opts.clientName}`,
      text: [
        `Hi ${opts.consultantName},`,
        "",
        `You have a new booking from ${opts.clientName} (${opts.clientEmail}).`,
        "",
        `When: ${localTime} (${opts.consultantTimezone})`,
        "",
        `Intake answers:`,
        ...Object.entries(opts.clientData).map(([k, v]) => `  ${k}: ${v}`),
        "",
        `Cancel: ${opts.cancelUrl}`,
      ].join("\n"),
    }, opts.icsContent));
  }

  async sendReminder(opts: ReminderOptions): Promise<void> {
    const localTime = opts.start.toLocaleString("en-US", {
      timeZone: opts.recipientTimezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    await sendMail({
      from: getConfig().FROM_EMAIL,
      to: opts.recipientEmail,
      subject: `Reminder: your booking is coming up`,
      text: [
        `Hi ${opts.recipientName},`,
        "",
        `Just a reminder — your booking starts soon.`,
        "",
        `When: ${localTime} (${opts.recipientTimezone})`,
        opts.videoLink ? `Video link: ${opts.videoLink}` : "",
      ]
        .filter((l) => l !== undefined)
        .join("\n"),
    });
  }

  async sendCancellation(opts: CancellationOptions): Promise<void> {
    const localTime = opts.start.toLocaleString("en-US", {
      timeZone: opts.recipientTimezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    await sendMail({
      from: getConfig().FROM_EMAIL,
      to: opts.recipientEmail,
      subject: `Booking cancelled`,
      text: [
        `Hi ${opts.recipientName},`,
        "",
        `Your booking has been cancelled.`,
        "",
        `Original time: ${localTime} (${opts.recipientTimezone})`,
      ].join("\n"),
    });
  }

  async sendPollInvite(opts: PollInviteOptions): Promise<void> {
    await sendMail({
      from: getConfig().FROM_EMAIL,
      to: opts.recipientEmail,
      subject: `You're invited: ${opts.pollTitle}`,
      text: [
        `Hi ${opts.recipientName},`,
        "",
        `You've been invited to vote on meeting availability.`,
        "",
        `Poll: ${opts.pollTitle}`,
        `Vote here: ${opts.pollUrl}`,
        opts.expiresAt ? `Expires: ${opts.expiresAt.toISOString()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  async sendPollConfirmation(opts: PollConfirmationOptions): Promise<void> {
    const localTime = opts.start.toLocaleString("en-US", {
      timeZone: opts.recipientTimezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    await sendMail(buildMessage({
      from: getConfig().FROM_EMAIL,
      to: opts.recipientEmail,
      subject: `Meeting time confirmed: ${opts.pollTitle}`,
      text: [
        `Hi ${opts.recipientName},`,
        "",
        `A meeting time has been confirmed for "${opts.pollTitle}".`,
        "",
        `When: ${localTime} (${opts.recipientTimezone})`,
      ].join("\n"),
    }, opts.icsContent));
  }
}
