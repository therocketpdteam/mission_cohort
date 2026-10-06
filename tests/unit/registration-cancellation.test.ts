import assert from "node:assert/strict";
import test from "node:test";
import { cancellationInvoiceDisposition, registrationCancellationEmail } from "../../src/config/registrationCancellation";
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
  assert.match(body, /issue a refund to the mailing address provided with your registration/);
  assert.match(body, /disregard the invoice we previously sent/);
  assert.doesNotMatch(body, /\{\{/);
});

test("voids and attaches only unpaid active invoices during cancellation", () => {
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: false }), "none");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "SENT", paidAmount: 0, paymentStatus: "PENDING" }), "void_and_attach");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "PAID", paidAmount: 2425, paymentStatus: "PAID" }), "refund_required");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "SENT", paidAmount: 100, paymentStatus: "PARTIAL" }), "refund_required");
  assert.equal(cancellationInvoiceDisposition({ hasInvoice: true, invoiceStatus: "VOIDED", paidAmount: 0 }), "already_voided");
});
