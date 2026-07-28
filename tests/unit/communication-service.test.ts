import assert from "node:assert/strict";
import test from "node:test";
import { EmailEventType } from "@prisma/client";
import { buildManualCustomEmailRecipientGroups, buildRecipientDeliveryRows, emailEventSummary, sessionTemplateTypesForSession } from "../../src/services/communicationService";

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

test("reviewed failed recipient events do not remain active review items", () => {
  const rows = buildRecipientDeliveryRows([
    { id: "1", recipientEmail: "reviewed@example.com", eventType: EmailEventType.FAILED, createdAt: new Date("2026-01-01T09:01:00Z"), reviewedAt: new Date("2026-01-01T10:01:00Z") }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].needsReview, false);
  assert.equal(rows[0].unreviewedIssueEvents.length, 0);
  assert.equal(rows[0].emailSummary.reviewedIssueCount, 1);
});

test("dedupes manual custom email recipients across participants and POCs", () => {
  const groups = buildManualCustomEmailRecipientGroups([
    {
      id: "participant-1",
      cohortId: "cohort-1",
      email: "Teacher@Example.com",
      registration: { id: "registration-1", primaryContactEmail: "poc@example.com" }
    },
    {
      id: "participant-2",
      cohortId: "cohort-1",
      email: "teacher@example.com",
      registration: { id: "registration-1", primaryContactEmail: "poc@example.com" }
    },
    {
      id: "participant-3",
      cohortId: "cohort-2",
      email: "other@example.com",
      registration: { id: "registration-2", primaryContactEmail: "poc@example.com" }
    }
  ], "participants_and_pocs");

  assert.deepEqual(groups.map((group) => group.cohortId), ["cohort-1", "cohort-2"]);
  assert.deepEqual(groups[0].recipientEmails, ["teacher@example.com", "poc@example.com"]);
  assert.deepEqual(groups[1].recipientEmails, ["other@example.com"]);
});

test("manual custom email recipient grouping does not filter by cohort lifecycle status", () => {
  const groups = buildManualCustomEmailRecipientGroups([
    { id: "draft-participant", cohortId: "draft-cohort", email: "draft@example.com", registration: { id: "draft-registration", primaryContactEmail: "draft-poc@example.com" } },
    { id: "completed-participant", cohortId: "completed-cohort", email: "completed@example.com", registration: { id: "completed-registration", primaryContactEmail: "completed-poc@example.com" } },
    { id: "active-participant", cohortId: "active-cohort", email: "active@example.com", registration: { id: "active-registration", primaryContactEmail: "active-poc@example.com" } }
  ], "participants");

  assert.deepEqual(groups.map((group) => group.cohortId), ["draft-cohort", "completed-cohort", "active-cohort"]);
  assert.deepEqual(groups.flatMap((group) => group.recipientEmails), ["draft@example.com", "completed@example.com", "active@example.com"]);
});

test("uses the one-week session reminder only for the first session", () => {
  assert.deepEqual(sessionTemplateTypesForSession(1).map(String), [
    "WEEK_BEFORE_REMINDER",
    "DAY_BEFORE_REMINDER",
    "HOUR_BEFORE_REMINDER",
    "FOLLOW_UP"
  ]);
  assert.deepEqual(sessionTemplateTypesForSession(2).map(String), [
    "DAY_BEFORE_REMINDER",
    "HOUR_BEFORE_REMINDER",
    "FOLLOW_UP"
  ]);
});
