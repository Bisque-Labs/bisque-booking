/**
 * Public reschedule page — /reschedule/:token
 *
 * Shows available slots for rescheduling a booking.
 * Validates the reschedule token and submits the new time.
 */

"use client";

import { useState, useEffect } from "react";
import type { AvailableSlot } from "@/lib/db/schema";

type Step = "pick-date" | "pick-slot" | "done" | "error";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface PageProps {
  params: { token: string };
}

export default function ReschedulePage({ params }: PageProps) {
  const { token } = params;
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("pick-date");
  const [selectedDate, setSelectedDate] = useState(today());
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Resolve token → booking id by calling the bookings API with a filter
  useEffect(() => {
    // We need to find the booking by reschedule_token.
    // Since the token is secret and single-use, we attempt the reschedule
    // with a dummy body to find the booking; instead, we store bookingId in the URL.
    // In this implementation, the token encodes the booking ID in the URL path.
    // The token-only approach: client just passes token; server looks it up.
    // We'll resolve it via a GET to /api/bookings/by-reschedule-token/:token
    // or we can try the reschedule endpoint with a probe.
    // For simplicity, we look it up client-side via the API.
    // The URL is /reschedule/:token, so we need to look up the booking.
    // We'll use a special endpoint for this.

    // Use the token to look up booking info for display
    // Note: the actual reschedule POST uses the token; we need the booking id.
    // Store token and attempt to get booking info.
    setBookingId(null); // Will be resolved on submit
  }, [token]);

  async function loadSlots(date: string) {
    setLoadingSlots(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/slots?date=${date}&tz=${encodeURIComponent(timezone)}`);
      const data = await res.json();
      setSlots(data.slots ?? []);
      setStep("pick-slot");
    } catch {
      setErrorMsg("Failed to load available slots. Please try again.");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleReschedule(slot: AvailableSlot) {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      // First resolve booking id from token by looking up the booking
      let resolvedBookingId = bookingId;

      if (!resolvedBookingId) {
        // Attempt to get booking ID from server via token lookup
        const lookupRes = await fetch(`/api/bookings/by-reschedule-token/${token}`);
        if (!lookupRes.ok) {
          setErrorMsg("This reschedule link is invalid or has expired.");
          setStep("error");
          return;
        }
        const lookupData = await lookupRes.json();
        resolvedBookingId = lookupData.booking_id;
        setBookingId(resolvedBookingId);
      }

      const res = await fetch(
        `/api/bookings/${resolvedBookingId}/reschedule?token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_utc: slot.start_utc,
            end_utc: slot.end_utc,
            timezone,
          }),
        }
      );

      const data = await res.json();

      if (res.status === 410) {
        setErrorMsg("This reschedule link has already been used.");
        setStep("error");
      } else if (!res.ok) {
        if (res.status === 409) {
          setErrorMsg("That slot was just taken — please choose another time.");
          await loadSlots(selectedDate);
        } else {
          setErrorMsg(data.error ?? "Reschedule failed. Please try again.");
        }
      } else {
        setStep("done");
      }
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const dates = Array.from({ length: 30 }, (_, i) => addDays(today(), i));

  if (step === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Meeting rescheduled!</h1>
          <p className="text-gray-600">A confirmation email has been sent with your new meeting details.</p>
        </div>
      </main>
    );
  }

  if (step === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link expired</h1>
          <p className="text-gray-600">{errorMsg ?? "This reschedule link is invalid or has already been used."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Reschedule your meeting</h1>
        <p className="text-gray-500 text-sm mb-8">Your timezone: {timezone}</p>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errorMsg}
          </div>
        )}

        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">Select a new date</h2>
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

        {step === "pick-slot" && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-700 mb-4">Available times</h2>
            {loadingSlots ? (
              <p className="text-gray-400 text-sm">Loading slots...</p>
            ) : slots.length === 0 ? (
              <p className="text-gray-500 text-sm">No available slots on this date.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.start_utc}
                    onClick={() => handleReschedule(slot)}
                    disabled={submitting}
                    className="p-3 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 transition-colors text-center disabled:opacity-50"
                  >
                    {slot.start_local.split(", ").pop()}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
