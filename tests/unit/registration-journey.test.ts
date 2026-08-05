import assert from "node:assert/strict";
import test from "node:test";
import { registrationConfirmationDocumentReadiness } from "../../src/services/registrationDocumentReadiness";
import {
  buildRegistrationMilestones,
  calendarFilesJourneyKey,
  participantConfirmationJourneyKey,
  pocConfirmationJourneyKey,
  shouldAutoPrepareRegistrationInvoice
} from "../../src/services/registrationJourneyService";
import {
  quickBooksProductionAutomationReadiness,
  registrationRequiresQuickBooksInvoice,
  shouldAutoSyncRegistrationInvoiceToQuickBooks
} from "../../src/services/quickBooksService";

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

test("calendar invite file sends are cohort scoped for moved registrations", () => {
  const original = calendarFilesJourneyKey({
    registrationId: "registration-1",
    participantEmail: "Teacher@Example.com",
    cohortId: "cohort-1"
  });
  const moved = calendarFilesJourneyKey({
    registrationId: "registration-1",
    participantEmail: "teacher@example.com",
    cohortId: "cohort-2"
  });

  assert.equal(original, "registration:registration-1:calendar-files:teacher@example.com:cohort:cohort-1");
  assert.equal(moved, "registration:registration-1:calendar-files:teacher@example.com:cohort:cohort-2");
  assert.notEqual(moved, original);
});

test("POC confirmations can be cohort scoped for moved registrations", () => {
  const original = pocConfirmationJourneyKey({
    registrationId: "registration-1",
    primaryContactEmail: "POC@Example.com",
    cohortId: "cohort-1"
  });
  const moved = pocConfirmationJourneyKey({
    registrationId: "registration-1",
    primaryContactEmail: "poc@example.com",
    cohortId: "cohort-2",
    batchKey: "move-1"
  });

  assert.equal(original, "registration:registration-1:poc:poc@example.com:confirmation:cohort:cohort-1");
  assert.equal(moved, "registration:registration-1:poc:poc@example.com:confirmation:cohort:cohort-2:batch:move-1");
  assert.notEqual(moved, original);
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

test("auto-prepares invoice PDFs only for paid registrations missing invoice documents", () => {
  assert.equal(shouldAutoPrepareRegistrationInvoice({
    paymentMethod: "INVOICE",
    totalAmount: 1590,
    invoiceUrl: null,
    invoiceDrafts: []
  }), true);
  assert.equal(shouldAutoPrepareRegistrationInvoice({
    paymentMethod: "PURCHASE_ORDER",
    totalAmount: 795,
    invoiceUrl: null,
    invoiceDrafts: [{ pdfUrl: "https://example.com/invoice.pdf" }]
  }), false);
  assert.equal(shouldAutoPrepareRegistrationInvoice({
    paymentMethod: "COMPED",
    totalAmount: 0,
    invoiceUrl: null,
    invoiceDrafts: []
  }), false);
});

test("QuickBooks automation stays paused until production is fully configured", () => {
  assert.deepEqual(quickBooksProductionAutomationReadiness({
    environment: "sandbox",
    parentCustomerRef: "123",
    serviceItemRef: "456",
    connected: true,
    realmId: "realm"
  }), {
    ready: false,
    environment: "sandbox",
    reason: "QuickBooks automation is paused until the connection is switched to production."
  });

  const missingServiceItem = quickBooksProductionAutomationReadiness({
    environment: "production",
    parentCustomerRef: "123",
    connected: true,
    realmId: "realm"
  });

  assert.equal(missingServiceItem.ready, false);
  assert.match(missingServiceItem.reason ?? "", /service item ref/);
});

test("QuickBooks invoice auto-linking only applies to unpaid production invoice registrations without an existing ref", () => {
  const readiness = quickBooksProductionAutomationReadiness({
    environment: "production",
    parentCustomerRef: "123",
    serviceItemRef: "456",
    connected: true,
    realmId: "realm"
  });

  assert.equal(readiness.ready, true);
  assert.equal(registrationRequiresQuickBooksInvoice({ paymentMethod: "INVOICE", totalAmount: 590 }), true);
  assert.equal(registrationRequiresQuickBooksInvoice({ paymentMethod: "COMPED", totalAmount: 0 }), false);
  assert.equal(shouldAutoSyncRegistrationInvoiceToQuickBooks({
    paymentMethod: "INVOICE",
    totalAmount: 590,
    quickBooksInvoiceRef: null,
    invoiceDrafts: [{ quickBooksInvoiceRef: null }]
  }, readiness), true);
  assert.equal(shouldAutoSyncRegistrationInvoiceToQuickBooks({
    paymentMethod: "INVOICE",
    totalAmount: 590,
    quickBooksInvoiceRef: "qb-100",
    invoiceDrafts: [{ quickBooksInvoiceRef: null }]
  }, readiness), false);
  assert.equal(shouldAutoSyncRegistrationInvoiceToQuickBooks({
    paymentMethod: "PURCHASE_ORDER",
    totalAmount: 590,
    quickBooksInvoiceRef: null,
    invoiceDrafts: [{ quickBooksInvoiceRef: "qb-101" }]
  }, readiness), false);
});
