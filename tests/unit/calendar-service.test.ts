import assert from "node:assert/strict";
import test from "node:test";
import { uniqueCalendarAttendees } from "../../src/modules/calendar/attendees";
import { buildSessionCalendarDescription } from "../../src/modules/calendar/description";
import { generateSessionIcs } from "../../src/modules/calendar/icsGenerator";
import { upsertGoogleCalendarEvent } from "../../src/modules/calendar/googleCalendarProvider";
import { filterCalendarAttendeesForRemoval } from "../../src/services/calendarService";

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

test("builds direct calendar invite files for one intended attendee", () => {
  const ics = generateSessionIcs({
    id: "session-1",
    title: "Introduction to a Thinking Classroom",
    description: "Bring your questions.",
    startTime: "2026-10-29T22:30:00.000Z",
    endTime: "2026-10-30T00:30:00.000Z",
    timezone: "America/New_York",
    meetingUrl: "https://zoom.us/j/123",
    cohort: { title: "Building Thinking Classrooms", presenterName: "Peter Liljedahl" },
    attendee: { email: "Teacher@Example.com", name: "Teacher One" }
  });

  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /ORGANIZER;CN=The RocketPD Team:mailto:support@rocketpd.com/);
  assert.match(ics, /ATTENDEE;CN="Teacher One";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:teacher@example.com/);
  assert.doesNotMatch(ics, /other@example.com/);
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

test("google calendar event updates are silent unless attendee notifications are explicit", async () => {
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
      attendees: [{ email: "participant@example.com", displayName: "Participant One" }]
    });

    assert.doesNotMatch(requestUrl, /sendUpdates=all/);
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

test("google calendar event updates can explicitly request no attendee notifications", async () => {
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
      sendUpdates: "none"
    });

    assert.match(requestUrl, /sendUpdates=none/);
    assert.doesNotMatch(requestUrl, /sendUpdates=all/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("filters only selected calendar attendees while preserving remaining RSVP metadata", () => {
  const attendees = [
    { email: "keep@example.com", displayName: "Keep Me", responseStatus: "accepted", optional: true, comment: "Still attending" },
    { email: " Remove@Example.com ", displayName: "Remove Me", responseStatus: "tentative" },
    { email: "other@example.com", displayName: "Other", responseStatus: "needsAction", additionalGuests: 1 }
  ];

  const result = filterCalendarAttendeesForRemoval(attendees, ["remove@example.com"]);

  assert.deepEqual(result.removed, ["remove@example.com"]);
  assert.deepEqual(result.preserved, [
    { email: "keep@example.com", displayName: "Keep Me", responseStatus: "accepted", optional: true, comment: "Still attending" },
    { email: "other@example.com", displayName: "Other", responseStatus: "needsAction", additionalGuests: 1 }
  ]);
});
