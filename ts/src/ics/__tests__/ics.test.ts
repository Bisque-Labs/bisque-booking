import { describe, it, expect } from "vitest";
import { generateIcs, generateCancellationIcs } from "../index";

const BASE_OPTS = {
  uid: "test-uid-123",
  title: "30-min Consultation",
  start: new Date("2025-06-15T14:00:00Z"),
  end: new Date("2025-06-15T14:30:00Z"),
  organizerEmail: "consultant@example.com",
  organizerName: "Jane Consultant",
  attendeeEmail: "client@example.com",
  attendeeName: "Bob Client",
  description: "A test meeting",
};

describe("generateIcs()", () => {
  it("returns a string with ICS headers", () => {
    const ics = generateIcs(BASE_OPTS);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("includes the title as SUMMARY", () => {
    const ics = generateIcs(BASE_OPTS);
    expect(ics).toContain("30-min Consultation");
  });

  it("includes organizer email", () => {
    const ics = generateIcs(BASE_OPTS);
    expect(ics).toContain("consultant@example.com");
  });

  it("includes attendee email", () => {
    const ics = generateIcs(BASE_OPTS);
    expect(ics).toContain("client@example.com");
  });

  it("sets METHOD:REQUEST", () => {
    const ics = generateIcs(BASE_OPTS);
    expect(ics).toContain("METHOD:REQUEST");
  });

  it("includes location when provided", () => {
    const ics = generateIcs({ ...BASE_OPTS, location: "https://meet.example.com/abc" });
    expect(ics).toContain("meet.example.com");
  });
});

describe("generateCancellationIcs()", () => {
  it("returns ICS with CANCEL method", () => {
    const ics = generateCancellationIcs({
      uid: "test-uid-123",
      title: "30-min Consultation",
      start: new Date("2025-06-15T14:00:00Z"),
      end: new Date("2025-06-15T14:30:00Z"),
      organizerEmail: "consultant@example.com",
      organizerName: "Jane Consultant",
      attendeeEmail: "client@example.com",
      attendeeName: "Bob Client",
    });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });
});
