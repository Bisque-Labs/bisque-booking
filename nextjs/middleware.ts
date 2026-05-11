/**
 * Next.js middleware — protects /admin/* routes.
 *
 * Verifies the admin_session JWT cookie.
 * Redirects to /admin/login if missing or invalid.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "change-me-in-production-at-least-32-chars!!"
);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Allow login page and logout endpoint
  if (pathname === "/admin/login" || pathname === "/api/admin/auth/login" || pathname === "/admin/logout") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const token = request.cookies.get("admin_session")?.value;

    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    try {
      await jwtVerify(token, SESSION_SECRET);
      return NextResponse.next();
    } catch {
      const response = NextResponse.redirect(new URL("/admin/login", request.url));
      response.cookies.delete("admin_session");
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
