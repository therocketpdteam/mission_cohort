import assert from "node:assert/strict";
import test from "node:test";
import { registrationConfirmationDocumentReadiness } from "../../src/services/registrationDocumentReadiness";
import { buildRegistrationMilestones, participantConfirmationJourneyKey } from "../../src/services/registrationJourneyService";

const cohortStart = new Date("2026-08-15T14:00:00.000Z");

test("schedules both cohort milestones for an early registration", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-07-01T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [true, true]);
  assert.equal(milestones[0]?.key, "three-weeks-before");
  assert.equal(milestones[0]?.templateName, "Three Weeks Before Cohort");
  assert.equal(milestones[0]?.scheduledFor.toISOString(), "2026-07-25T14:00:00.000Z");
  assert.equal(milestones[1]?.scheduledFor.toISOString(), "2026-08-08T14:00:00.000Z");
});

test("skips the three-week message but keeps the one-week message for a late registration", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-07-26T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [false, true]);
});

test("skips both cohort milestones for a registration made inside the final week", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-08-12T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [false, false]);
});

test("cohort move participant confirmations use unique cohort and batch scoped journey keys", () => {
  const original = participantConfirmationJourneyKey({
    registrationId: "registration-1",
    participantEmail: "Teacher@Example.com"
  });
  const moved = participantConfirmationJourneyKey({
    registrationId: "registration-1",
    participantEmail: "Teacher@Example.com",
    cohortId: "cohort-2",
    batchKey: "move-1"
  });
  const movedAgain = participantConfirmationJourneyKey({
    registrationId: "registration-1",
    participantEmail: "teacher@example.com",
    cohortId: "cohort-2",
    batchKey: "move-2"
  });

  assert.equal(original, "registration:registration-1:participant:teacher@example.com:confirmation");
  assert.notEqual(moved, original);
  assert.notEqual(movedAgain, moved);
  assert.match(moved, /cohort:cohort-2:batch:move-1$/);
});

test("holds POC confirmations until invoice and W-9 documents are ready", () => {
  const readiness = registrationConfirmationDocumentReadiness({
    paymentMethod: "INVOICE",
    totalAmount: 1590,
    invoiceDrafts: []
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["RocketPD W-9 URL", "invoice PDF/link"]);
  assert.match(readiness.reason ?? "", /POC confirmation held/);
});

test("allows POC confirmations with invoice PDF and global W-9 fallback", () => {
  const readiness = registrationConfirmationDocumentReadiness({
    paymentMethod: "PURCHASE_ORDER",
    totalAmount: 795,
    invoiceDrafts: [{ pdfUrl: "https://example.com/invoice.pdf" }]
  }, "https://example.com/w9.pdf");

  assert.equal(readiness.ready, true);
  assert.equal(readiness.invoiceUrl, "https://example.com/invoice.pdf");
  assert.equal(readiness.w9Url, "https://example.com/w9.pdf");
  assert.deepEqual(readiness.missing, []);
});

test("does not require an invoice for comped registrations", () => {
  const readiness = registrationConfirmationDocumentReadiness({
    paymentMethod: "COMPED",
    totalAmount: 0,
    invoiceDrafts: []
  }, "https://example.com/w9.pdf");

  assert.equal(readiness.ready, true);
  assert.equal(readiness.requiresInvoice, false);
});
