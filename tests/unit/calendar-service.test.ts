import assert from "node:assert/strict";
import test from "node:test";
import { uniqueCalendarAttendees } from "../../src/modules/calendar/attendees";
import { buildSessionCalendarDescription } from "../../src/modules/calendar/description";
import { upsertGoogleCalendarEvent } from "../../src/modules/calendar/googleCalendarProvider";

test("normalizes and deduplicates calendar attendees", () => {
  const attendees = uniqueCalendarAttendees([
    { email: " Gerardo@RocketPD.com ", displayName: " Gerardo Grosso " },
    { email: "gerardo@rocketpd.com", displayName: "Duplicate" },
    { email: "participant@example.com", displayName: "Participant" },
    { email: "not-an-email", displayName: "Invalid" },
    { email: "", displayName: "Missing" }
  ]);

  assert.deepEqual(attendees, [
    { email: "gerardo@rocketpd.com", displayName: "Gerardo Grosso" },
    { email: "participant@example.com", displayName: "Participant" }
  ]);
});

test("builds a readable calendar invite description", () => {
  const description = buildSessionCalendarDescription({
    cohort: {
      title: "Building Thinking Classrooms",
      presenterName: "Peter Liljedahl",
      description: "A live virtual professional learning cohort."
    },
    session: {
      title: "Introduction to a Thinking Classroom",
      description: "Bring your questions and current classroom routines.",
      meetingUrl: "https://zoom.us/j/123"
    }
  });

  assert.equal(description, [
    "Cohort: Building Thinking Classrooms",
    "Session: Introduction to a Thinking Classroom",
    "Presenter: Peter Liljedahl",
    "",
    "Bring your questions and current classroom routines.",
    "",
    "Join Zoom: https://zoom.us/j/123",
    "Questions? Email info@rocketpd.com."
  ].join("\n"));
});

test("google calendar events hide the guest list by default", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: any = null;
  globalThis.fetch = (async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "event_123", htmlLink: "https://calendar.google.com/event" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await upsertGoogleCalendarEvent({
      title: "Session 1",
      description: "Calendar body",
      startTime: "2026-10-29T22:30:00.000Z",
      endTime: "2026-10-30T00:30:00.000Z",
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123",
      accessToken: "token",
      calendarId: "support@rocketpd.com",
      attendees: [{ email: "participant@example.com", displayName: "Participant One" }],
      sendUpdates: true
    });

    assert.equal(result.id, "event_123");
    assert.match(requestUrl, /sendUpdates=all/);
    assert.equal(requestBody.description, "Calendar body");
    assert.equal(requestBody.location, "https://zoom.us/j/123");
    assert.equal(requestBody.guestsCanInviteOthers, false);
    assert.equal(requestBody.guestsCanModify, false);
    assert.equal(requestBody.guestsCanSeeOtherGuests, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google calendar event updates can suppress attendee notifications", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.fetch = (async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({ id: "event_123", htmlLink: "https://calendar.google.com/event" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    await upsertGoogleCalendarEvent({
      title: "Session 1",
      description: "Calendar body",
      startTime: "2026-10-29T22:30:00.000Z",
      endTime: "2026-10-30T00:30:00.000Z",
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123",
      accessToken: "token",
      calendarId: "support@rocketpd.com",
      providerEventId: "event_123",
      attendees: [{ email: "remaining@example.com", displayName: "Remaining Participant" }],
      sendUpdates: false
    });

    assert.doesNotMatch(requestUrl, /sendUpdates=all/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
