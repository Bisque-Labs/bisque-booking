/**
 * Kissinger CRM adapter.
 *
 * Enabled when KISSINGER_GRAPHQL_URL is set in the environment.
 * Upserts a Contact and creates an Interaction in Kissinger's graph
 * when a booking is confirmed.
 *
 * The booking core has no knowledge of this module. Register it at startup:
 *
 *   import { kissingerAdapter } from "@/lib/adapters/kissinger";
 *   import { registerBookingAdapter } from "@/lib/adapters";
 *   if (process.env.KISSINGER_GRAPHQL_URL) {
 *     registerBookingAdapter(kissingerAdapter);
 *   }
 */

import type { BookingAdapter, BookingConfirmed, BookingCancelled } from "@/lib/db/schema";

const KISSINGER_URL = process.env.KISSINGER_GRAPHQL_URL;

async function graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  if (!KISSINGER_URL) throw new Error("KISSINGER_GRAPHQL_URL not set");
  const res = await fetch(KISSINGER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Kissinger HTTP ${res.status}`);
  return res.json();
}

export const kissingerAdapter: BookingAdapter = {
  async onBookingConfirmed(event: BookingConfirmed): Promise<void> {
    // Upsert contact by email
    await graphql(
      `mutation UpsertContact($email: String!, $name: String!) {
         upsertContact(email: $email, name: $name) { id }
       }`,
      { email: event.contact_email, name: event.contact_name }
    );

    // Create interaction
    await graphql(
      `mutation CreateInteraction($contactEmail: String!, $type: String!, $metadata: JSON!) {
         createInteraction(contactEmail: $contactEmail, type: $type, metadata: $metadata) { id }
       }`,
      {
        contactEmail: event.contact_email,
        type: "meeting",
        metadata: {
          booking_id: event.booking_id,
          start: event.start_utc,
          end: event.end_utc,
          notes: event.notes,
        },
      }
    );
  },

  async onBookingCancelled(event: BookingCancelled): Promise<void> {
    // Optional: mark the interaction as cancelled in Kissinger
    await graphql(
      `mutation CancelBookingInteraction($bookingId: String!) {
         cancelBookingInteraction(bookingId: $bookingId) { id }
       }`,
      { bookingId: event.booking_id }
    );
  },
};
