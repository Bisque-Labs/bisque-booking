/**
 * Admin layout — wraps all /admin/* pages.
 *
 * Auth is enforced via middleware (see middleware.ts).
 * Password stored in ADMIN_PASSWORD env var.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "bisque-booking admin",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-gray-900 text-sm">bisque-booking</span>
        <a href="/admin" className="text-sm text-gray-600 hover:text-gray-900">Dashboard</a>
        <a href="/admin/bookings" className="text-sm text-gray-600 hover:text-gray-900">Bookings</a>
        <a href="/admin/settings" className="text-sm text-gray-600 hover:text-gray-900">Settings</a>
        <div className="ml-auto">
          <a href="/admin/logout" className="text-sm text-red-500 hover:text-red-700">Log out</a>
        </div>
      </nav>
      <div className="p-6">{children}</div>
    </div>
  );
}
