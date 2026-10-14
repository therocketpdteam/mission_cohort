import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistributionTotals } from "../../src/lib/distributionTotals";

test("calculates the amount currently payable from collected revenue", () => {
  const totals = calculateDistributionTotals({
    registrations: [
      { status: "COMPLETED", paymentStatus: "PAID", totalAmount: 100_000 },
      { status: "COMPLETED", paymentStatus: "INVOICED", totalAmount: 50_000 }
    ],
    payments: [
      { status: "PAID", amount: 100_000 },
      { status: "INVOICED", amount: 50_000 }
    ],
    payouts: [{ status: "PAID", amount: 40_000 }],
    commissionPercent: 35,
    tlSharePercent: 65
  });

  assert.deepEqual(totals, {
    soldAmount: 150_000,
    commissionableAmount: 150_000,
    paidAmount: 100_000,
    outstandingAmount: 50_000,
    commissionAmount: 52_500,
    tlShareAmount: 97_500,
    paymentRatio: 2 / 3,
    tlPayoutDue: 65_000,
    payoutMade: 40_000,
    pendingPayout: 25_000,
    projectReturn: 60_000,
    returnPercent: 60
  });
});

test("excludes cancelled and refunded registrations from commissionable revenue", () => {
  const totals = calculateDistributionTotals({
    registrations: [
      { status: "CANCELLED", paymentStatus: "INVOICED", totalAmount: 500 },
      { status: "COMPLETED", paymentStatus: "REFUNDED", totalAmount: 500 },
      { status: "COMPLETED", paymentStatus: "PAID", totalAmount: 1_000 }
    ],
    payments: [{ status: "PAID", amount: 1_000 }],
    payouts: [{ status: "CANCELLED", amount: 650 }],
    commissionPercent: 35,
    tlSharePercent: 65
  });

  assert.equal(totals.commissionableAmount, 1_000);
  assert.equal(totals.tlPayoutDue, 650);
  assert.equal(totals.payoutMade, 0);
  assert.equal(totals.pendingPayout, 650);
});

test("preserves sold revenue but removes uncollectible balances from commissionable revenue", () => {
  const totals = calculateDistributionTotals({
    registrations: [
      { status: "COMPLETED", paymentStatus: "PAID", totalAmount: 1_000 },
      { status: "COMPLETED", paymentStatus: "UNCOLLECTIBLE", totalAmount: 500 }
    ],
    payments: [
      { status: "PAID", amount: 1_000 },
      { status: "UNCOLLECTIBLE", amount: 500 }
    ],
    payouts: [],
    commissionPercent: 40,
    tlSharePercent: 60
  });

  assert.equal(totals.soldAmount, 1_500);
  assert.equal(totals.commissionableAmount, 1_000);
  assert.equal(totals.outstandingAmount, 0);
  assert.equal(totals.tlPayoutDue, 600);
});
