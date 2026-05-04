/**
 * HTTP webhook provider — fires HMAC-signed POST requests.
 * Layer 5: concrete WebhookProvider implementation.
 *
 * Uses the configured WEBHOOK_URL and WEBHOOK_SECRET env vars.
 * Falls back to a no-op if WEBHOOK_URL is not set.
 */

import { createHmac } from "node:crypto";
import type { WebhookProvider } from "./types";
import { getConfig } from "@/config";

export class HttpWebhookProvider implements WebhookProvider {
  async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const cfg = getConfig();
    if (!cfg.WEBHOOK_URL) {
      console.debug(`[Webhook] No WEBHOOK_URL configured — skipping event=${event}`);
      return;
    }

    const body = JSON.stringify({ event, payload, timestamp: Date.now() });

    // HMAC-SHA256 signature for payload verification
    const signature = cfg.WEBHOOK_SECRET
      ? createHmac("sha256", cfg.WEBHOOK_SECRET).update(body).digest("hex")
      : "";

    try {
      const resp = await fetch(cfg.WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bisque-Event": event,
          "X-Bisque-Signature": `sha256=${signature}`,
        },
        body,
      });
      if (!resp.ok) {
        console.warn(
          `[Webhook] POST ${cfg.WEBHOOK_URL} returned ${resp.status} for event=${event}`,
        );
      }
    } catch (e) {
      console.error(`[Webhook] Failed to dispatch event=${event}:`, e);
    }
  }
}
