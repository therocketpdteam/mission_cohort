import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInvoiceNumber,
  invoiceYearFromCohort,
  nextInvoiceSequence,
  presenterInvoiceCode,
  shouldInvalidateInvoiceDocuments
} from "../../src/services/invoiceService";

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
