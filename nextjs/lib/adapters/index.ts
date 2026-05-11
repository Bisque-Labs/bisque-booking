/**
 * Booking adapter registry.
 *
 * Adapters are optional integrations that listen for booking lifecycle events.
 * The core booking system has zero knowledge of any specific adapter.
 *
 * Usage:
 *   registerBookingAdapter(kissingerAdapter);
 *   await emitBookingConfirmed(event);
 */

import type { BookingAdapter, BookingConfirmed, BookingCancelled } from "@/lib/db/schema";

const adapters: BookingAdapter[] = [];

export function registerBookingAdapter(adapter: BookingAdapter): void {
  adapters.push(adapter);
}

export async function emitBookingConfirmed(event: BookingConfirmed): Promise<void> {
  await Promise.allSettled(
    adapters.map(async (adapter) => {
      try {
        await adapter.onBookingConfirmed?.(event);
      } catch (err) {
        console.error("[adapter] onBookingConfirmed failed:", err);
      }
    })
  );
}

export async function emitBookingCancelled(event: BookingCancelled): Promise<void> {
  await Promise.allSettled(
    adapters.map(async (adapter) => {
      try {
        await adapter.onBookingCancelled?.(event);
      } catch (err) {
        console.error("[adapter] onBookingCancelled failed:", err);
      }
    })
  );
}
