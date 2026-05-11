/**
 * GET    /api/admin/blocked-dates         — list blocked date ranges
 * POST   /api/admin/blocked-dates         — add a blocked date range
 * DELETE /api/admin/blocked-dates?id=123  — remove a blocked date range
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { BlockedDate } from "@/lib/db/schema";

export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const blocked = db
    .prepare("SELECT * FROM blocked_dates ORDER BY start_date")
    .all() as BlockedDate[];
  return NextResponse.json({ blocked });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { start_date, end_date, reason } = body as Record<string, string>;

  if (!start_date || !end_date) {
    return NextResponse.json({ error: "start_date and end_date are required" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  }

  if (start_date > end_date) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare("INSERT INTO blocked_dates (start_date, end_date, reason) VALUES (?, ?, ?)")
    .run(start_date, end_date, reason ?? null);

  const created = db
    .prepare("SELECT * FROM blocked_dates WHERE id = ?")
    .get(result.lastInsertRowid) as BlockedDate;

  return NextResponse.json({ blocked: created }, { status: 201 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM blocked_dates WHERE id = ?")
    .get(parseInt(id)) as BlockedDate | undefined;

  if (!existing) {
    return NextResponse.json({ error: "Blocked date not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM blocked_dates WHERE id = ?").run(parseInt(id));
  return NextResponse.json({ success: true });
}
