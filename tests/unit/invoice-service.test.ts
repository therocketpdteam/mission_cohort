import assert from "node:assert/strict";
import test from "node:test";
import { shouldInvalidateInvoiceDocuments } from "../../src/services/invoiceService";

test("printable invoice edits invalidate generated documents", () => {
  assert.equal(shouldInvalidateInvoiceDocuments({ lineItems: [{ description: "Seat", quantity: 1, unitAmount: 795 }] }), true);
  assert.equal(shouldInvalidateInvoiceDocuments({ purchaseOrderNumber: "PO-123" }), true);
  assert.equal(shouldInvalidateInvoiceDocuments({ paidAmount: 795 }), true);
});

test("accounting reference edits do not invalidate generated documents", () => {
  assert.equal(shouldInvalidateInvoiceDocuments({ quickBooksInvoiceRef: "QB-1001" }), false);
  assert.equal(shouldInvalidateInvoiceDocuments({ quickBooksCustomerRef: "Customer-42", quickBooksRealmId: "realm" }), false);
});
