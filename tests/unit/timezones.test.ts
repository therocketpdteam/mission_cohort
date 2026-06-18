import assert from "node:assert/strict";
import test from "node:test";
import { dateTimeInputInZoneToIso, dateToDateTimeInputInZone } from "../../src/lib/timezones";

test("converts Eastern Standard session input to UTC", () => {
  assert.equal(dateTimeInputInZoneToIso("2026-01-15T10:00", "America/New_York"), "2026-01-15T15:00:00.000Z");
});

test("converts Eastern Daylight session input to UTC", () => {
  assert.equal(dateTimeInputInZoneToIso("2026-06-15T10:00", "America/New_York"), "2026-06-15T14:00:00.000Z");
});

test("formats stored UTC session time in the session timezone", () => {
  assert.equal(dateToDateTimeInputInZone("2026-06-15T14:00:00.000Z", "America/New_York"), "2026-06-15T10:00");
});
