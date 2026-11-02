import assert from "node:assert/strict";
import test from "node:test";
import { calculateCohortFinance, registrationCollectedAmount } from "../../src/lib/cohortFinance";

test("list and detail shapes agree when paid registrations still have invoiced ledger rows", () => {
  const registrations = [
    { id: "paid-ledger", paymentStatus: "PAID", totalAmount: 800 },
    { id: "paid-status", paymentStatus: "PAID", totalAmount: 100 },
    { id: "unpaid", paymentStatus: "INVOICED", totalAmount: 100 },
    { id: "writeoff", paymentStatus: "UNCOLLECTIBLE", totalAmount: 100 }
  ];
  const payments = [
    { registrationId: "paid-ledger", status: "PAID", amount: 800 },
    { registrationId: "paid-status", status: "INVOICED", amount: 100 },
    { registrationId: "unpaid", status: "INVOICED", amount: 100 }
  ];
  const list = calculateCohortFinance({ registrations, payments, invoices: [] });
  const detail = calculateCohortFinance({ registrations: registrations.map(r => ({
    ...r, paymentRecords: payments.filter(p => p.registrationId === r.id), invoiceDrafts: []
  })) });
  assert.deepEqual(list, detail);
  assert.deepEqual(list, { totalSales: 1100, collectibleSales: 1000, paidAmount: 900, uncollectibleAmount: 100, outstandingAmount: 100, paidPercent: 90 });
});

test("combines partial payments and invoice evidence without counting the same payment twice", () => {
  const registrations = [{ id: "partial", paymentStatus: "PARTIALLY_PAID", totalAmount: 1000 }];
  const result = calculateCohortFinance({ registrations,
    payments: [{ registrationId: "partial", status: "PARTIALLY_PAID", amount: 200 }, { registrationId: "partial", status: "PAID", amount: 100 }],
    invoices: [{ registrationId: "partial", status: "SENT", paidAmount: 400 }, { registrationId: "partial", status: "VOIDED", paidAmount: 500 }]
  });
  assert.equal(result.paidAmount, 400);
  assert.equal(result.outstandingAmount, 600);
  assert.equal(result.paidPercent, 40);
});

test("excludes archived, cancelled, refunded, and unrelated payment rows", () => {
  const registrations = [
    { id: "active", paymentStatus: "PAID", totalAmount: 100 },
    { id: "archived", archivedAt: "2026-11-02", paymentStatus: "PAID", totalAmount: 100 },
    { id: "cancelled", status: "CANCELLED", paymentStatus: "PAID", totalAmount: 100 },
    { id: "refunded", paymentStatus: "REFUNDED", totalAmount: 100 }
  ];
  const result = calculateCohortFinance({ registrations, payments: [
    { registrationId: "archived", status: "PAID", amount: 100 },
    { registrationId: "cancelled", status: "PAID", amount: 100 },
    { registrationId: "refunded", status: "PAID", amount: 100 },
    { registrationId: "another-cohort", status: "PAID", amount: 100 }
  ] });
  assert.equal(result.totalSales, 100);
  assert.equal(result.paidAmount, 100);
  assert.equal(result.paidPercent, 100);
});

test("keeps partial collections on written-off registrations and excludes only the unpaid remainder", () => {
  const result = calculateCohortFinance({ registrations: [{ id: "writeoff", paymentStatus: "UNCOLLECTIBLE", totalAmount: 1000 }],
    payments: [{ registrationId: "writeoff", status: "PARTIALLY_PAID", amount: 300 }]
  });
  assert.equal(result.paidAmount, 300);
  assert.equal(result.uncollectibleAmount, 700);
  assert.equal(result.collectibleSales, 300);
  assert.equal(result.outstandingAmount, 0);
  assert.equal(result.paidPercent, 100);
});

test("uses one decimal consistently and does not show 100 percent with an outstanding balance", () => {
  const finance = (paid: number) => calculateCohortFinance({ registrations: [{ id: "r", totalAmount: 10000 }], payments: [{ registrationId: "r", status: "PARTIALLY_PAID", amount: paid }] });
  assert.equal(finance(9957).paidPercent, 99.6);
  assert.equal(finance(9999.99).paidPercent, 99.9);
  assert.equal(finance(10000).paidPercent, 100);
});

test("handles empty and comped cohorts without inventing collected revenue", () => {
  assert.deepEqual(calculateCohortFinance({ registrations: [] }), { totalSales: 0, collectibleSales: 0, paidAmount: 0, uncollectibleAmount: 0, outstandingAmount: 0, paidPercent: 0 });
  assert.equal(registrationCollectedAmount({ paymentMethod: "COMPED", paymentStatus: "PAID", totalAmount: 0, participantCount: 1 }), 0);
});
