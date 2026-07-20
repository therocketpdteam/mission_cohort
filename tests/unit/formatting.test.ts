import assert from "node:assert/strict";
import test from "node:test";
import { formatRegistrationPaymentStatus, isCompedRegistration } from "../../src/lib/formatting";

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
