import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * Lightweight liveness check used by the Docker healthcheck and any external
 * uptime monitors. Returns 200 as long as the Next.js process is running.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "unknown",
  });
}
