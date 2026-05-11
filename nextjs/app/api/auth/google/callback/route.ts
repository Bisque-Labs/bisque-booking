/**
 * GET /api/auth/google/callback
 *
 * Handles Google OAuth callback.
 * Exchanges the authorization code for tokens and stores them.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { exchangeCode } from "@/lib/google-calendar";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/admin/settings?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.json({ error: "No authorization code received" }, { status: 400 });
  }

  try {
    const db = getDb();
    await exchangeCode(db, code);
    return NextResponse.redirect(new URL("/admin/settings?google=connected", request.url));
  } catch (err) {
    console.error("[google/callback]", err);
    return NextResponse.redirect(
      new URL("/admin/settings?error=token_exchange_failed", request.url)
    );
  }
}
