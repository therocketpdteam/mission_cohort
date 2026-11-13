import test from "node:test";
import assert from "node:assert/strict";
import { postSessionWindow, validRecordingLink } from "../../src/lib/postSessionSendNow";
const now = Date.parse("2026-11-13T18:00:00Z");
const message = { sessionId: "s1", status: "SCHEDULED", sentAt: null, template: { type: "FOLLOW_UP" }, scheduledFor: "2026-11-13T22:00:00Z" };
const session = { endTime: "2026-11-12T22:00:00Z", recordingUrl: "https://example.org/recording" };
test("future and ongoing sessions cannot send early", () => {
  assert.equal(postSessionWindow(message, { ...session, endTime: "2026-11-13T19:00:00Z" }, now).eligible, false);
});
test("window uses actual stored schedule and UTC instants including offset-equivalent times", () => {
  assert.equal(postSessionWindow(message, session, now).eligible, true);
  assert.equal(postSessionWindow(message, { ...session, endTime: "2026-11-13T13:00:00-05:00" }, now).eligible, true);
  assert.equal(postSessionWindow(message, session, Date.parse(message.scheduledFor)).eligible, false);
  assert.equal(postSessionWindow({ ...message, scheduledFor: "2026-11-13T17:00:00Z" }, session, now).eligible, false);
});
test("manual and automatic sent statuses and in-flight claims are unavailable", () => {
  for (const status of ["SENT", "SENDING", "CANCELLED", "DRAFT"]) assert.equal(postSessionWindow({ ...message, status }, session, now).eligible, false);
});
test("recording is required, with only valid HTTP(S) URLs accepted", () => {
  for (const recordingUrl of [null, "", "javascript:alert(1)", "ftp://example.org/a", "not a url", "https://user:secret@example.org/a"]) {
    assert.equal(validRecordingLink(recordingUrl), false);
    assert.match(postSessionWindow(message, { ...session, recordingUrl }, now).reason!, /valid recording link/);
  }
});
test("failed delivery remains safely retryable only within its original window", () => {
  assert.equal(postSessionWindow({ ...message, status: "FAILED" }, session, now).eligible, true);
  assert.equal(postSessionWindow({ ...message, status: "FAILED" }, session, Date.parse(message.scheduledFor)).eligible, false);
});
test("invalid timestamps and unrelated workflows are unavailable", () => {
  assert.equal(postSessionWindow(message, { ...session, endTime: "invalid" }, now).eligible, false);
  assert.equal(postSessionWindow({ ...message, template: { type: "HOUR_BEFORE_REMINDER" } }, session, now).eligible, false);
});
