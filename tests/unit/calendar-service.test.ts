import assert from "node:assert/strict";
import test from "node:test";
import { uniqueCalendarAttendees } from "../../src/modules/calendar/attendees";

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
