import assert from "node:assert/strict";
import test from "node:test";
import { cancellationInvoiceDisposition, cancellationPaymentMessage, registrationCancellationEmail } from "../../src/config/registrationCancellation";
import { renderMergeFields, sampleMergeContext, validateMergeFields } from "../../src/modules/email";

test("registration cancellation email uses supported merge fields and renders its POC details", () => {
  const source = [
    registrationCancellationEmail.subject,
    registrationCancellationEmail.bodyHtml,
    registrationCancellationEmail.bodyText
  ].join("\n");

  assert.deepEqual(validateMergeFields(source), []);

  const subject = renderMergeFields(registrationCancellationEmail.subject, sampleMergeContext).output;
  const body = renderMergeFields(registrationCancellationEmail.bodyText, sampleMergeContext).output;
  assert.equal(subject, "Registration cancelled: Instructional Leadership Spring Cohort");
  assert.match(body, /Hello Avery,/);
  assert.match(body, /Northview School District/);
  assert.match(body, /INV-1001/);
  assert.doesNotMatch(body, /\{\{/);
});

test("uses payment-specific cancellation instructions", () => {
  assert.match(cancellationPaymentMessage({
    paymentReceived: false,
    paymentMethod: "INVOICE",
    invoiceNumber: "PL-2026-437",
    cancellationDate: "October 16, 2026"
  }).text, /not received payment.*No balance is due.*PL-2026-437 has been voided/i);

  assert.match(cancellationPaymentMessage({
    paymentReceived: true,
    paymentMethod: "CREDIT_CARD",
    cancellationDate: "October 16, 2026"
  }).text, /original method.*10 days from October 16, 2026/i);

  assert.match(cancellationPaymentMessage({
    paymentReceived: true,
    paymentMethod: "CHECK",
    cancellationDate: "October 16, 2026"
  }).text, /recipient's name.*mailing address.*check or ACH/i);

  assert.match(cancellationPaymentMessage({
    paymentReceived: true,
    paymentMethod: "ACH",
    cancellationDate: "October 16, 2026"
  }).text, /ACH to the original account or by check/i);
});

test("voids and attaches only unpaid active invoices during cancellation", () => {
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: false }), "none");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "SENT", paidAmount: 0, paymentStatus: "PENDING" }), "void_and_attach");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "PAID", paidAmount: 2425, paymentStatus: "PAID" }), "refund_required");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "SENT", paidAmount: 100, paymentStatus: "PARTIAL" }), "refund_required");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "VOIDED", paidAmount: 0 }), "already_voided");
});
