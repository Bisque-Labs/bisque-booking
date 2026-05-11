/**
 * POST /api/admin/auth/login
 *
 * Validates the admin password and sets a session cookie.
 * ADMIN_PASSWORD env var sets the password.
 * SESSION_SECRET env var signs the cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "change-me-in-production-at-least-32-chars!!"
);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { password } = await request.json().catch(() => ({}));

  if (!password || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Create a JWT session token (expires in 7 days)
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SESSION_SECRET);

  const response = NextResponse.json({ success: true });
  response.cookies.set("admin_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
