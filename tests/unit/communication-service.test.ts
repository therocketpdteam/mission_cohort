import assert from "node:assert/strict";
import test from "node:test";
import { EmailEventType } from "@prisma/client";
import { buildRecipientDeliveryRows, emailEventSummary } from "../../src/services/communicationService";

test("summarizes unreviewed failed and bounced email events", () => {
  const summary = emailEventSummary([
    { eventType: EmailEventType.SENT, createdAt: new Date("2026-01-01T10:00:00Z") },
    { eventType: EmailEventType.DELIVERED, createdAt: new Date("2026-01-01T10:01:00Z") },
    { eventType: EmailEventType.OPENED, createdAt: new Date("2026-01-01T10:02:00Z") },
    { eventType: EmailEventType.FAILED, createdAt: new Date("2026-01-01T10:03:00Z") },
    { eventType: EmailEventType.BOUNCED, createdAt: new Date("2026-01-01T10:04:00Z"), reviewedAt: new Date("2026-01-01T11:00:00Z") }
  ]);

  assert.equal(summary.deliveredCount, 1);
  assert.equal(summary.openedCount, 1);
  assert.equal(summary.issueCount, 2);
  assert.equal(summary.unreviewedIssueCount, 1);
  assert.equal(summary.reviewedIssueCount, 1);
  assert.equal(summary.lastEmailEvent, EmailEventType.BOUNCED);
});

test("builds recipient delivery rows and prioritizes recipients needing review", () => {
  const rows = buildRecipientDeliveryRows([
    { id: "1", recipientEmail: "ok@example.com", eventType: EmailEventType.DELIVERED, createdAt: new Date("2026-01-01T10:00:00Z") },
    { id: "2", recipientEmail: "broken@example.com", eventType: EmailEventType.SENT, createdAt: new Date("2026-01-01T09:00:00Z") },
    { id: "3", recipientEmail: "broken@example.com", eventType: EmailEventType.FAILED, createdAt: new Date("2026-01-01T09:01:00Z") }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].recipientEmail, "broken@example.com");
  assert.equal(rows[0].needsReview, true);
  assert.equal(rows[0].unreviewedIssueEvents.length, 1);
  assert.equal(rows[1].recipientEmail, "ok@example.com");
  assert.equal(rows[1].needsReview, false);
});
