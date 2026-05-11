/**
 * Admin settings page — /admin/settings
 *
 * Shows Google Calendar connection status.
 * Redirects to Google OAuth when user clicks "Connect".
 */

import { getDb } from "@/lib/db";
import { isGoogleConnected } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  const db = getDb();
  const googleConnected = isGoogleConnected(db);
  const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Google Calendar</h2>
        {!googleEnabled ? (
          <p className="text-sm text-gray-500">
            Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to enable Calendar sync.
          </p>
        ) : googleConnected ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span className="text-sm text-green-700 font-medium">Connected</span>
            <span className="text-sm text-gray-500 ml-2">Google Calendar busy blocks are being subtracted from available slots.</span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">Not connected.</span>
            <a
              href="/api/auth/google"
              className="text-sm bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
            >
              Connect Google Calendar
            </a>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Availability</h2>
        <a
          href="/admin/availability"
          className="text-sm text-orange-500 hover:underline"
        >
          Configure working hours and blocked dates →
        </a>
      </section>
    </div>
  );
}
