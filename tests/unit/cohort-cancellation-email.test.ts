import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCohortCancellationPocEmail,
  cohortCancellationParticipantEmail,
  cohortCancellationPaymentMessage,
  renderCohortCancellationEmail,
  type CohortCancellationPaymentInput
} from "../../src/config/cohortCancellation";
import { sampleMergeContext, validateMergeFields } from "../../src/modules/email/mergeFields";

const unpaid: CohortCancellationPaymentInput = {
  paymentStatus: "INVOICED",
  paymentMethod: "PURCHASE_ORDER",
  invoiceNumber: "DP-2026-437",
  purchaseOrderNumber: "PO-123",
  cancellationDate: "October 19, 2026"
};

test("participant cancellation renders supported merge fields without financial details or premature calendar claims", () => {
  const template = cohortCancellationParticipantEmail;
  assert.deepEqual(validateMergeFields(Object.values(template).join("\n")), []);
  const email = renderCohortCancellationEmail(template, sampleMergeContext);
  assert.deepEqual(email.warnings, []);
  assert.match(email.bodyText, /Hello Jordan,/);
  assert.match(email.bodyText, /Instructional Leadership Spring Cohort/);
  assert.match(email.bodyText, /nothing you need to do/);
  assert.match(email.bodyText, /will remove/);
  assert.match(email.bodyText, /hope to welcome you/);
  assert.doesNotMatch(email.bodyText, /invoice|refund|paid|Northview|already removed|have been removed|\{\{/i);
});

test("POC email renders the administrative table and applicable payment instructions", () => {
  const template = buildCohortCancellationPocEmail(unpaid);
  assert.deepEqual(validateMergeFields(Object.values(template).join("\n")), []);
  const email = renderCohortCancellationEmail(template, {
    ...sampleMergeContext,
    registration: { ...sampleMergeContext.registration, invoiceNumber: unpaid.invoiceNumber, purchaseOrderNumber: unpaid.purchaseOrderNumber }
  });
  assert.deepEqual(email.warnings, []);
  assert.match(email.bodyHtml, /<table/);
  assert.match(email.bodyText, /Hello Avery,/);
  assert.match(email.bodyText, /Organization: Northview School District/);
  assert.match(email.bodyText, /Invoice: DP-2026-437/);
  assert.match(email.bodyText, /Purchase order: PO-123/);
  assert.match(email.bodyText, /DP-2026-437 will be voided/);
  assert.doesNotMatch(email.bodyText, /has been voided|\{\{/);
});

test("missing invoice and PO rows are omitted rather than displaying empty merge fields", () => {
  const template = buildCohortCancellationPocEmail({ ...unpaid, invoiceNumber: null, purchaseOrderNumber: " " });
  const email = renderCohortCancellationEmail(template, {
    ...sampleMergeContext,
    registration: { ...sampleMergeContext.registration, invoiceNumber: null, purchaseOrderNumber: null }
  });
  assert.deepEqual(email.warnings, []);
  assert.doesNotMatch(email.bodyText, /Invoice:|Purchase order:|voided/);
});

test("paid credit cards retain the existing original-method refund policy and cancellation date", () => {
  const message = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", paymentMethod: "CREDIT_CARD", receivedAmount: 795 });
  assert.match(message.text, /original method of payment/);
  assert.match(message.text, /10 days from October 19, 2026/);
  assert.doesNotMatch(message.text, /voided|refund has been issued/);
});

test("check and ACH refunds request the relevant confirmation without asking for banking information by email", () => {
  const check = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", paymentMethod: "CHECK" });
  assert.match(check.text, /recipient's name, mailing address/);
  assert.match(check.text, /check or ACH/);
  assert.match(check.text, /do not email banking information/);
  const ach = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", receivedPaymentMethods: ["ACH"] });
  assert.match(ach.text, /ACH to the original account or by check/);
});

test("a paid PO or invoice without an actual receipt method requests refund confirmation", () => {
  for (const paymentMethod of ["PURCHASE_ORDER", "INVOICE", "UNKNOWN"]) {
    const message = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", paymentMethod });
    assert.equal(message.kind, "confirmation_required");
    assert.match(message.text, /received payment/);
    assert.doesNotMatch(message.text, /not received|credit card|voided/);
  }
});

test("actual received payment takes precedence over an invoiced status and PO billing arrangement", () => {
  const message = cohortCancellationPaymentMessage({ ...unpaid, receivedAmount: 795, receivedPaymentMethods: ["CREDIT_CARD"] });
  assert.equal(message.kind, "credit_card");
  assert.doesNotMatch(message.text, /not received payment/);
});

test("mixed receipt methods do not incorrectly promise an entirely credit card refund", () => {
  const message = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", paymentMethod: "CREDIT_CARD", receivedPaymentMethods: ["CREDIT_CARD", "CHECK"] });
  assert.equal(message.kind, "confirmation_required");
});

test("partial payments have refund instructions and explicitly cancel the remaining balance", () => {
  const message = cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PARTIALLY_PAID", paymentMethod: "CHECK", receivedAmount: 200 });
  assert.match(message.text, /refund/);
  assert.match(message.text, /remaining unpaid balance will be cancelled/);
  assert.doesNotMatch(message.text, /invoice.*voided/i);
});

test("refunded and complimentary registrations do not promise another refund", () => {
  assert.match(cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "REFUNDED" }).text, /already been refunded/);
  const complimentary = cohortCancellationPaymentMessage({ ...unpaid, paymentMethod: "COMPED", paymentStatus: "PENDING" });
  assert.equal(complimentary.kind, "complimentary");
  assert.match(complimentary.text, /No payment or refund is required/);
});

test("only an already voided invoice is described in the past tense", () => {
  assert.match(cohortCancellationPaymentMessage({ ...unpaid, invoiceStatus: "VOIDED" }).text, /DP-2026-437 has been voided/);
});

test("unreviewed financial state cannot silently produce unpaid or undated refund promises", () => {
  assert.throws(() => cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "UNKNOWN" }), /Review/);
  assert.throws(() => cohortCancellationPaymentMessage({ ...unpaid, receivedAmount: -1 }), /non-negative/);
  assert.throws(() => cohortCancellationPaymentMessage({ ...unpaid, paymentStatus: "PAID", paymentMethod: "CREDIT_CARD", cancellationDate: "" }), /cancellation date/);
});

test("rendered HTML escapes recipient and invoice values while plain text stays readable", () => {
  const invoiceNumber = '<img src=x onerror="alert(1)">';
  const template = buildCohortCancellationPocEmail({ ...unpaid, invoiceNumber });
  const email = renderCohortCancellationEmail(template, {
    ...sampleMergeContext,
    organization: { name: "A & B <District>" },
    registration: { ...sampleMergeContext.registration, invoiceNumber }
  });
  assert.match(email.bodyHtml, /A &amp; B &lt;District&gt;/);
  assert.match(email.bodyHtml, /&lt;img/);
  assert.doesNotMatch(email.bodyHtml, /<img|<District>/);
  assert.match(email.bodyText, /A & B <District>/);
});

test("missing greeting names use a natural fallback and a missing cohort title blocks the draft", () => {
  const email = renderCohortCancellationEmail(cohortCancellationParticipantEmail, { cohort: { title: "DP Fall 2026" } });
  assert.match(email.bodyText, /Hello there,/);
  assert.throws(() => renderCohortCancellationEmail(cohortCancellationParticipantEmail, {}), /cohort title/);
});
