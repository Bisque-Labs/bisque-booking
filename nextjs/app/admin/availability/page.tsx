/**
 * Admin availability configuration — /admin/availability
 *
 * Form to set working hours per day-of-week, buffer minutes,
 * max bookings per day, and manage blocked dates.
 */

"use client";

import { useState, useEffect } from "react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface AvailabilityWindow {
  id?: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

interface BookingConfig {
  buffer_minutes: number;
  max_bookings_per_day: number;
  slot_duration_minutes: number;
  admin_timezone: string;
  admin_email: string;
  admin_name: string;
}

interface BlockedDate {
  id: number;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export default function AdminAvailabilityPage() {
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [config, setConfig] = useState<BookingConfig>({
    buffer_minutes: 15,
    max_bookings_per_day: 8,
    slot_duration_minutes: 30,
    admin_timezone: "UTC",
    admin_email: "",
    admin_name: "",
  });
  const [blocked, setBlocked] = useState<BlockedDate[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // New blocked date form
  const [newBlocked, setNewBlocked] = useState({ start_date: "", end_date: "", reason: "" });
  const [addingBlocked, setAddingBlocked] = useState(false);

  useEffect(() => {
    fetch("/api/admin/availability")
      .then((r) => r.json())
      .then((data) => {
        setWindows(data.windows ?? []);
        if (data.config) setConfig(data.config);
      })
      .catch(() => setError("Failed to load availability settings"));

    fetch("/api/admin/blocked-dates")
      .then((r) => r.json())
      .then((data) => setBlocked(data.blocked ?? []))
      .catch(() => {});
  }, []);

  function toggleDay(dow: number) {
    const existing = windows.find((w) => w.day_of_week === dow);
    if (existing) {
      setWindows(windows.filter((w) => w.day_of_week !== dow));
    } else {
      setWindows([...windows, { day_of_week: dow, start_time: "09:00", end_time: "17:00", timezone: config.admin_timezone }]);
    }
  }

  function updateWindow(dow: number, field: "start_time" | "end_time", value: string) {
    setWindows(windows.map((w) => w.day_of_week === dow ? { ...w, [field]: value } : w));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    // Validate
    for (const w of windows) {
      if (w.start_time >= w.end_time) {
        setError(`${DAYS[w.day_of_week]}: end time must be after start time`);
        setSaving(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/admin/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windows, config }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
      } else {
        setSuccess(true);
        setWindows(data.windows ?? []);
      }
    } catch {
      setError("Save failed — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBlocked() {
    if (!newBlocked.start_date || !newBlocked.end_date) return;
    setAddingBlocked(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/blocked-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBlocked),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add blocked date");
      } else {
        setBlocked([...blocked, data.blocked]);
        setNewBlocked({ start_date: "", end_date: "", reason: "" });
      }
    } catch {
      setError("Failed to add blocked date");
    } finally {
      setAddingBlocked(false);
    }
  }

  async function handleDeleteBlocked(id: number) {
    try {
      const res = await fetch(`/api/admin/blocked-dates?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setBlocked(blocked.filter((b) => b.id !== id));
      }
    } catch {
      setError("Failed to delete blocked date");
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Availability Settings</h1>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">Settings saved successfully.</div>
      )}

      {/* Working hours */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Working Hours</h2>
        <div className="space-y-3">
          {DAYS.map((day, dow) => {
            const w = windows.find((x) => x.day_of_week === dow);
            const enabled = !!w;
            return (
              <div key={dow} className="flex items-center gap-4">
                <label className="flex items-center gap-2 w-28 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(dow)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">{day}</span>
                </label>
                {enabled && (
                  <>
                    <input
                      type="time"
                      value={w.start_time}
                      onChange={(e) => updateWindow(dow, "start_time", e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                    />
                    <span className="text-gray-400 text-sm">to</span>
                    <input
                      type="time"
                      value={w.end_time}
                      onChange={(e) => updateWindow(dow, "end_time", e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Config */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Booking Settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slot duration (min)</label>
            <input
              type="number"
              value={config.slot_duration_minutes}
              onChange={(e) => setConfig({ ...config, slot_duration_minutes: parseInt(e.target.value) || 30 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              min={15}
              max={480}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Buffer between bookings (min)</label>
            <input
              type="number"
              value={config.buffer_minutes}
              onChange={(e) => setConfig({ ...config, buffer_minutes: parseInt(e.target.value) || 0 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              min={0}
              max={240}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max bookings per day</label>
            <input
              type="number"
              value={config.max_bookings_per_day}
              onChange={(e) => setConfig({ ...config, max_bookings_per_day: parseInt(e.target.value) || 8 })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              min={1}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your timezone</label>
            <input
              type="text"
              value={config.admin_timezone}
              onChange={(e) => setConfig({ ...config, admin_timezone: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="America/New_York"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input
              type="text"
              value={config.admin_name}
              onChange={(e) => setConfig({ ...config, admin_name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your email</label>
            <input
              type="email"
              value={config.admin_email}
              onChange={(e) => setConfig({ ...config, admin_email: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Blocked dates */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Blocked Dates</h2>
        {blocked.length > 0 && (
          <ul className="space-y-2 mb-4">
            {blocked.map((b) => (
              <li key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {b.start_date === b.end_date ? b.start_date : `${b.start_date} – ${b.end_date}`}
                  {b.reason && <span className="text-gray-400 ml-2">({b.reason})</span>}
                </span>
                <button
                  onClick={() => handleDeleteBlocked(b.id)}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            type="date"
            value={newBlocked.start_date}
            onChange={(e) => setNewBlocked({ ...newBlocked, start_date: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={newBlocked.end_date}
            onChange={(e) => setNewBlocked({ ...newBlocked, end_date: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={newBlocked.reason}
            onChange={(e) => setNewBlocked({ ...newBlocked, reason: e.target.value })}
            placeholder="Reason (optional)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
          />
          <button
            onClick={handleAddBlocked}
            disabled={addingBlocked || !newBlocked.start_date}
            className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-900 disabled:opacity-50"
          >
            Block
          </button>
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-orange-500 text-white font-semibold py-3 rounded-xl hover:bg-orange-600 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </div>
  );
}
