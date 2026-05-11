/**
 * GET /api/auth/google
 *
 * Initiates Google OAuth flow for Calendar read access.
 * Redirects to Google's authorization page.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthUrl } from "@/lib/google-calendar";

export async function GET(): Promise<NextResponse> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google Calendar not configured" }, { status: 501 });
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = getAuthUrl(state);

  return NextResponse.redirect(authUrl);
}
