/**
 * Admin dashboard — /admin
 *
 * Shows upcoming bookings at a glance.
 */

import { getDb } from "@/lib/db";
import type { Booking } from "@/lib/db/schema";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatDateTime(utcStr: string, timezone: string): string {
  return new Date(utcStr).toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const db = getDb();

  const upcoming = db
    .prepare(
      "SELECT * FROM bookings WHERE status IN ('confirmed','pending') AND start_utc > ? ORDER BY start_utc ASC LIMIT 10"
    )
    .all(new Date().toISOString()) as Booking[];

  const totalBookings = (db.prepare("SELECT COUNT(*) as n FROM bookings").get() as { n: number }).n;
  const confirmedToday = (
    db
      .prepare(
        "SELECT COUNT(*) as n FROM bookings WHERE status = 'confirmed' AND start_utc LIKE ? || '%'"
      )
      .get(new Date().toISOString().slice(0, 10)) as { n: number }
  ).n;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{upcoming.length}</div>
          <div className="text-sm text-gray-500">Upcoming bookings</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{confirmedToday}</div>
          <div className="text-sm text-gray-500">Confirmed today</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{totalBookings}</div>
          <div className="text-sm text-gray-500">Total bookings</div>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-700">Upcoming</h2>
          <Link href="/admin/bookings" className="text-sm text-orange-500 hover:underline">View all</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-gray-400 text-sm">No upcoming bookings.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcoming.map((b) => (
              <li key={b.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800 text-sm">{b.contact_name}</p>
                  <p className="text-xs text-gray-400">{b.contact_email}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">{formatDateTime(b.start_utc, b.timezone)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {b.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
