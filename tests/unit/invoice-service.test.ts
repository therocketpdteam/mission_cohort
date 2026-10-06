import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInvoiceNumber,
  invoiceYearFromCohort,
  nextInvoiceSequence,
  presenterInvoiceCode,
  shouldInvalidateInvoiceDocuments
} from "../../src/services/invoiceService";
import { buildInvoicePdf, invoiceDescriptionParts } from "../../src/services/pdfService";

test("printable invoice edits invalidate generated documents", () => {
  assert.equal(shouldInvalidateInvoiceDocuments({ lineItems: [{ description: "Seat", quantity: 1, unitAmount: 795 }] }), true);
  assert.equal(shouldInvalidateInvoiceDocuments({ purchaseOrderNumber: "PO-123" }), true);
  assert.equal(shouldInvalidateInvoiceDocuments({ paidAmount: 795 }), true);
});

test("accounting reference edits do not invalidate generated documents", () => {
  assert.equal(shouldInvalidateInvoiceDocuments({ quickBooksInvoiceRef: "QB-1001" }), false);
  assert.equal(shouldInvalidateInvoiceDocuments({ quickBooksCustomerRef: "Customer-42", quickBooksRealmId: "realm" }), false);
});

test("formats invoice numbers with presenter code session year and running sequence", () => {
  assert.equal(presenterInvoiceCode({ firstName: "Kim", lastName: "Marshall" }), "KM");
  assert.equal(presenterInvoiceCode({ firstName: "The Core", lastName: "Group" }), "TCG");
  assert.equal(invoiceYearFromCohort({
    startDate: new Date("2025-09-01T00:00:00.000Z"),
    sessions: [
      { startTime: new Date("2026-02-01T15:00:00.000Z") },
      { startTime: new Date("2026-01-15T15:00:00.000Z") }
    ]
  }), 2026);
  assert.equal(nextInvoiceSequence([]), 355);
  assert.equal(nextInvoiceSequence(["KM-2026-355", "PL-2026-356", "legacy-100"]), 357);
  assert.equal(formatInvoiceNumber({ presenterCode: "KM", year: 2026, sequence: 355 }), "KM-2026-355");
});

test("prints cohort title and description as separate invoice line text", () => {
  assert.deepEqual(invoiceDescriptionParts(
    "RocketPD cohort seats",
    "Learning Cohort - Truly Effective Teacher Supervision, Coaching, and Evaluation",
    "Join Kim Marshall for a year of structured learning."
  ), {
    title: "Learning Cohort - Truly Effective Teacher Supervision, Coaching, and Evaluation",
    detail: "Join Kim Marshall for a year of structured learning."
  });

  assert.deepEqual(invoiceDescriptionParts(
    "Learning Cohort - Truly Effective Teacher Supervision, Coaching, and Evaluation - Older copy",
    "Learning Cohort - Truly Effective Teacher Supervision, Coaching, and Evaluation",
    "Updated cohort copy."
  ), {
    title: "Learning Cohort - Truly Effective Teacher Supervision, Coaching, and Evaluation",
    detail: "Updated cohort copy."
  });
});

test("prints a prominent VOIDED watermark for voided invoices", () => {
  const pdf = buildInvoicePdf({
    issuer: { displayName: "RocketPD", legalName: "In Demand Group, LLC", email: "info@rocketpd.com", website: "rocketpd.com" },
    documentType: "invoice",
    invoiceNumber: "PL-2026-466",
    status: "VOIDED",
    organizationName: "Lackawanna City School District",
    organizationAddressLines: [],
    cohortTitle: "Building Thinking Classrooms",
    issueDate: "10/1/2026",
    dueDate: "-",
    lineItems: [{ description: "Building Thinking Classrooms", quantity: 5, unitAmount: "$485.00", totalAmount: "$2,425.00" }],
    subtotalAmount: "$2,425.00",
    taxAmount: "$0.00",
    totalAmount: "$2,425.00",
    paidAmount: "$0.00",
    balanceAmount: "$2,425.00",
    notes: "VOIDED - This invoice is no longer payable."
  });

  assert.match(pdf.toString("latin1"), /\(VOIDED\) Tj/);
});
