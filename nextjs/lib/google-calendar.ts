/**
 * Google Calendar integration (BIS-663).
 *
 * Enabled when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 * OAuth2 tokens stored in the google_tokens SQLite table.
 *
 * Falls back gracefully if the API is unavailable.
 */

import type Database from "better-sqlite3";
import type { GoogleToken } from "@/lib/db/schema";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_REDIRECT_URI = `${process.env.BASE_URL ?? "http://localhost:3000"}/api/auth/google/callback`;

export interface BusyBlock {
  start: number; // ms timestamp
  end: number;   // ms timestamp
}

export function getAuthUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(
  db: Database.Database,
  code: string
): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiryDate = data.expires_in ? Date.now() + data.expires_in * 1000 : null;

  db.prepare(`
    INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date, updated_at)
    VALUES (1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).run(data.access_token, data.refresh_token ?? null, expiryDate);
}

async function refreshAccessToken(db: Database.Database, token: GoogleToken): Promise<string> {
  if (!token.refresh_token) throw new Error("No refresh token available");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiryDate = data.expires_in ? Date.now() + data.expires_in * 1000 : null;

  db.prepare(
    "UPDATE google_tokens SET access_token = ?, expiry_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1"
  ).run(data.access_token, expiryDate);

  return data.access_token;
}

async function getValidAccessToken(db: Database.Database): Promise<string | null> {
  const token = db.prepare("SELECT * FROM google_tokens WHERE id = 1").get() as GoogleToken | undefined;
  if (!token) return null;

  // Refresh if expired (with 60s buffer)
  if (token.expiry_date && token.expiry_date < Date.now() + 60_000) {
    return refreshAccessToken(db, token);
  }

  return token.access_token;
}

export async function getGoogleBusyBlocks(
  db: Database.Database,
  timeMin: Date,
  timeMax: Date
): Promise<BusyBlock[]> {
  const accessToken = await getValidAccessToken(db);
  if (!accessToken) return [];

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google freebusy failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } };
  };

  const busy = data.calendars?.primary?.busy ?? [];
  return busy.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));
}

export function isGoogleConnected(db: Database.Database): boolean {
  const token = db.prepare("SELECT id FROM google_tokens WHERE id = 1").get();
  return !!token;
}
