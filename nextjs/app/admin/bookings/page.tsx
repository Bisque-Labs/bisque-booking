/**
 * Admin bookings list — /admin/bookings
 *
 * Paginated table of all bookings. Upcoming first, then past.
 * Cancel and reschedule actions call the respective API routes.
 */

"use client";

import { useState, useEffect, useCallback } from "react";

interface Booking {
  id: string;
  contact_name: string;
  contact_email: string;
  start_utc: string;
  end_utc: string;
  timezone: string;
  status: string;
  notes: string | null;
  cancel_token: string;
  reschedule_token: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-red-100 text-red-700",
  rescheduled: "bg-blue-100 text-blue-700",
};

function formatDateTime(utcStr: string, tz = "UTC"): string {
  return new Date(utcStr).toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const loadBookings = useCallback(async (off: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings?limit=${limit + 1}&offset=${off}`);
      const data = await res.json();
      const items: Booking[] = data.bookings ?? [];
      setHasMore(items.length > limit);
      setBookings(items.slice(0, limit));
    } catch {
      setError("Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBookings(offset);
  }, [offset, loadBookings]);

  async function handleCancel(booking: Booking) {
    if (!confirm(`Cancel booking for ${booking.contact_name}?`)) return;
    setActionLoading(booking.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/bookings/${booking.id}/cancel?token=${booking.cancel_token}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Cancel failed");
      } else {
        loadBookings(offset);
      }
    } catch {
      setError("Cancel request failed");
    } finally {
      setActionLoading(null);
    }
  }

  // Sort: upcoming first (confirmed/pending), then past/cancelled
  const sortedBookings = [...bookings].sort((a, b) => {
    const aActive = a.status === "confirmed" || a.status === "pending";
    const bActive = b.status === "confirmed" || b.status === "pending";
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return new Date(a.start_utc).getTime() - new Date(b.start_utc).getTime();
  });

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">All Bookings</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : bookings.length === 0 ? (
        <p className="text-gray-400 text-sm">No bookings yet.</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Guest</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">When</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{booking.contact_name}</p>
                      <p className="text-xs text-gray-400">{booking.contact_email}</p>
                      {booking.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic truncate max-w-xs">{booking.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateTime(booking.start_utc, booking.timezone)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[booking.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {booking.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {(booking.status === "confirmed" || booking.status === "pending") && (
                        <button
                          onClick={() => handleCancel(booking)}
                          disabled={actionLoading === booking.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? "..." : "Cancel"}
                        </button>
                      )}
                      {(booking.status === "confirmed" || booking.status === "pending") && (
                        <a
                          href={`/reschedule/${booking.reschedule_token}`}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          Reschedule
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 mt-4 justify-end">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={!hasMore}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
