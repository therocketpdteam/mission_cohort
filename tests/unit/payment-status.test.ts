import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentStatus } from "@prisma/client";
import { deriveRegistrationPaymentStatusFromRecords } from "../../src/lib/paymentStatus";

describe("deriveRegistrationPaymentStatusFromRecords", () => {
  it("marks a single refunded payment record as refunded", () => {
    assert.equal(
      deriveRegistrationPaymentStatusFromRecords([{ status: PaymentStatus.REFUNDED, amount: 295 }], PaymentStatus.PAID, 295),
      PaymentStatus.REFUNDED
    );
  });

  it("marks collected payments as paid when they cover the registration total", () => {
    assert.equal(
      deriveRegistrationPaymentStatusFromRecords([{ status: PaymentStatus.PARTIALLY_PAID, amount: 295 }], PaymentStatus.PENDING, 295),
      PaymentStatus.PAID
    );
  });

  it("keeps partial payments partial when they do not cover the registration total", () => {
    assert.equal(
      deriveRegistrationPaymentStatusFromRecords([{ status: PaymentStatus.PARTIALLY_PAID, amount: 100 }], PaymentStatus.PENDING, 295),
      PaymentStatus.PARTIALLY_PAID
    );
  });
});
