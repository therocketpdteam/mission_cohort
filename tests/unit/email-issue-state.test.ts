import assert from "node:assert/strict";
import test from "node:test";
import { activeEmailIssues } from "../../src/lib/emailIssueState";

test("keeps an unresolved failed delivery active", () => {
  const events = [{ eventType: "FAILED", recipientEmail: "person@example.com", createdAt: "2026-09-24T10:00:00Z" }];
  assert.equal(activeEmailIssues(events).length, 1);
});

test("resolves an earlier failure after a later successful send to the same recipient", () => {
  const events = [
    { eventType: "FAILED", recipientEmail: "Person@Example.com", createdAt: "2026-09-24T10:00:00Z" },
    { eventType: "SENT", recipientEmail: "person@example.com", createdAt: "2026-09-24T11:00:00Z" }
  ];
  assert.equal(activeEmailIssues(events).length, 0);
});

test("does not let another recipient's success hide a failure", () => {
  const events = [
    { eventType: "FAILED", recipientEmail: "first@example.com", createdAt: "2026-09-24T10:00:00Z" },
    { eventType: "DELIVERED", recipientEmail: "second@example.com", createdAt: "2026-09-24T11:00:00Z" }
  ];
  assert.equal(activeEmailIssues(events).length, 1);
});

test("keeps a later bounce active after an earlier send", () => {
  const events = [
    { eventType: "SENT", recipientEmail: "person@example.com", createdAt: "2026-09-24T10:00:00Z" },
    { eventType: "BOUNCED", recipientEmail: "person@example.com", createdAt: "2026-09-24T11:00:00Z" }
  ];
  assert.equal(activeEmailIssues(events).length, 1);
});
