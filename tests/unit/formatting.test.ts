import assert from "node:assert/strict";
import test from "node:test";
import { formatRegistrationPaymentStatus, isCompedRegistration, matchesRegistrationPaymentFilter } from "../../src/lib/formatting";

test("labels free registrations separately from invoice collection", () => {
  assert.equal(formatRegistrationPaymentStatus({
    paymentMethod: "COMPED",
    paymentStatus: "INVOICED",
    totalAmount: 0,
    participantCount: 1
  }), "Free");
  assert.equal(isCompedRegistration({
    paymentMethod: "UNKNOWN",
    paymentStatus: "INVOICED",
    totalAmount: 0,
    participantCount: 1
  }), true);
  assert.equal(formatRegistrationPaymentStatus({
    paymentMethod: "INVOICE",
    paymentStatus: "INVOICED",
    totalAmount: 795,
    participantCount: 1
  }), "Invoiced");
});

test("withdrawn registrations do not match their stale invoice or payment status", () => {
  for (const paymentStatus of ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID"]) {
    const withdrawn = { status: "CANCELLED", paymentStatus, totalAmount: 1590 };
    assert.equal(matchesRegistrationPaymentFilter(withdrawn, paymentStatus), false);
    assert.equal(matchesRegistrationPaymentFilter(withdrawn, "WITHDRAWN"), true);
    assert.equal(matchesRegistrationPaymentFilter(withdrawn, ""), true);
  }
});

test("archived invoice records appear under Withdrawn rather than Invoiced", () => {
  const archived = { status: "COMPLETED", paymentStatus: "INVOICED", totalAmount: 1590, archivedAt: "2026-11-02T12:00:00.000Z" };
  assert.equal(matchesRegistrationPaymentFilter(archived, "INVOICED"), false);
  assert.equal(matchesRegistrationPaymentFilter(archived, "WITHDRAWN"), true);
});

test("completed registrations with outstanding invoices remain invoiced until withdrawn", () => {
  const completed = { status: "COMPLETED", paymentStatus: "INVOICED", totalAmount: 1590 };
  assert.equal(matchesRegistrationPaymentFilter(completed, "INVOICED"), true);
  assert.equal(matchesRegistrationPaymentFilter(completed, "WITHDRAWN"), false);
});

test("free registrations do not appear in invoice collection filters", () => {
  const free = { status: "CONFIRMED", paymentStatus: "INVOICED", paymentMethod: "COMPED", totalAmount: 0, participantCount: 1 };
  assert.equal(matchesRegistrationPaymentFilter(free, "INVOICED"), false);
  assert.equal(matchesRegistrationPaymentFilter(free, "FREE"), true);
});

test("ordinary payment filters retain active paid, invoiced, and partial registrations", () => {
  for (const paymentStatus of ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "UNCOLLECTIBLE"]) {
    const registration = { status: "CONFIRMED", paymentStatus, totalAmount: 1590 };
    assert.equal(matchesRegistrationPaymentFilter(registration, paymentStatus), true);
    assert.equal(matchesRegistrationPaymentFilter(registration, "WITHDRAWN"), false);
  }
});
