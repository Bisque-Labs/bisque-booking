/**
 * Public booking page — /book
 *
 * Unauthenticated. Shows a date picker, then available slots,
 * then a contact form. All in a single-page flow.
 */

"use client";

import { useState } from "react";
import type { AvailableSlot } from "@/lib/db/schema";

type Step = "pick-date" | "pick-slot" | "contact-form" | "confirmed";

interface BookingConfirmation {
  booking: {
    id: string;
    start_utc: string;
    end_utc: string;
    timezone: string;
    contact_name: string;
    contact_email: string;
  };
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BookPage() {
  const [step, setStep] = useState<Step>("pick-date");
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [form, setForm] = useState({ name: "", email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function loadSlots(date: string) {
    setLoadingSlots(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking/slots?date=${date}&tz=${encodeURIComponent(timezone)}`);
      const data = await res.json();
      setSlots(data.slots ?? []);
      setStep("pick-slot");
    } catch {
      setError("Failed to load available slots. Please try again.");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submitBooking() {
    if (!selectedSlot || !form.name || !form.email) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_name: form.name,
          contact_email: form.email,
          start_utc: selectedSlot.start_utc,
          end_utc: selectedSlot.end_utc,
          timezone,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Booking failed. Please try again.");
        return;
      }
      setConfirmation(data);
      setStep("confirmed");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Generate next 30 days for date picker
  const dates = Array.from({ length: 30 }, (_, i) => addDays(today(), i));

  if (step === "confirmed" && confirmation) {
    const start = new Date(confirmation.booking.start_utc);
    const localStart = start.toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const gcalUrl = new URL("https://calendar.google.com/calendar/render");
    gcalUrl.searchParams.set("action", "TEMPLATE");
    gcalUrl.searchParams.set("text", `Meeting with ${confirmation.booking.contact_name}`);
    gcalUrl.searchParams.set("dates", `${confirmation.booking.start_utc.replace(/[-:]/g, "").slice(0, 15)}Z/${confirmation.booking.end_utc.replace(/[-:]/g, "").slice(0, 15)}Z`);

    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re booked!</h1>
          <p className="text-gray-600 mb-4">A confirmation email has been sent to <strong>{confirmation.booking.contact_email}</strong>.</p>
          <p className="text-lg font-medium text-gray-800 mb-6">{localStart}</p>
          <a
            href={gcalUrl.toString()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-blue-500 text-white font-semibold px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors text-sm"
          >
            Add to Google Calendar
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Schedule a meeting</h1>
        <p className="text-gray-500 text-sm mb-8">Your timezone: {timezone}</p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Pick a date */}
        {(step === "pick-date" || step === "pick-slot") && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold text-gray-700 mb-4">Select a date</h2>
            <div className="grid grid-cols-5 gap-2">
              {dates.map((date) => (
                <button
                  key={date}
                  onClick={() => {
                    setSelectedDate(date);
                    loadSlots(date);
                  }}
                  className={`p-2 rounded-lg text-center text-sm transition-colors ${
                    selectedDate === date
                      ? "bg-orange-500 text-white font-semibold"
                      : "bg-gray-50 text-gray-700 hover:bg-orange-50 hover:text-orange-700"
                  }`}
                >
                  <div className="font-medium">{new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  <div className="text-xs opacity-75">{new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Step 2: Pick a slot */}
        {step === "pick-slot" && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold text-gray-700 mb-4">
              Available times for {formatDate(selectedDate)}
            </h2>
            {loadingSlots ? (
              <p className="text-gray-400 text-sm">Loading slots...</p>
            ) : slots.length === 0 ? (
              <p className="text-gray-500 text-sm">No available slots on this date. Please pick another day.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.start_utc}
                    onClick={() => {
                      setSelectedSlot(slot);
                      setStep("contact-form");
                    }}
                    className="p-3 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 transition-colors text-center"
                  >
                    {slot.start_local.split(", ").pop()}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Step 3: Contact form */}
        {step === "contact-form" && selectedSlot && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <button
              onClick={() => setStep("pick-slot")}
              className="text-sm text-orange-500 hover:underline mb-4 block"
            >
              &larr; Change time
            </button>
            <div className="p-3 bg-orange-50 rounded-lg text-orange-800 text-sm font-medium mb-6">
              {formatDate(selectedDate)} at {selectedSlot.start_local.split(", ").pop()}
            </div>
            <h2 className="font-semibold text-gray-700 mb-4">Your details</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">What would you like to discuss? (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  placeholder="Brief agenda or context..."
                />
              </div>
              <button
                onClick={submitBooking}
                disabled={submitting || !form.name || !form.email}
                className="w-full bg-orange-500 text-white font-semibold py-3 rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Booking..." : "Confirm booking"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
