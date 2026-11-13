import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma";
import { recordCheckPaymentDocument } from "../../src/services/checkPaymentService";
import { updateRegistrationDocuments } from "../../src/services/registrationService";
import { registrationDocumentSchema } from "../../src/validators/registrationDocument";
import { checkPaymentNotes, checkReconciliationPreview, readCheckPaymentProof } from "../../src/lib/checkPayment";
import { deriveRegistrationPaymentStatusFromRecords } from "../../src/lib/paymentStatus";
import { registrationCollectedAmount } from "../../src/lib/cohortFinance";
import { GET as getDocument } from "../../src/app/api/registration-documents/route";

const proof = (amount = 100, number = "00123", extra: object = {}) => ({ type: "checkPayment" as const, fileKey: "check-payment/proof.pdf", fileName: "proof.pdf", contentType: "application/pdf", checkAmount: amount, checkNumber: number, ...extra });
function fixture() {
  return { id: "r1", cohortId: "c1", organizationId: "o1", totalAmount: 300, paymentMethod: "PURCHASE_ORDER", paymentStatus: "INVOICED", status: "CONFIRMED", archivedAt: null, invoiceNumber: "INV-1", checkPaymentFileKey: null, paymentRecords: [] as any[], invoiceDrafts: [] as any[] } as any;
}
async function withLedger(run: (registration: any, audit: any[], locks: any[], followUps: any[]) => Promise<void>) {
  const registration = fixture(), audit: any[] = [], locks: any[] = [], followUps: any[] = [];
  const forbidden = async () => { throw new Error("Unexpected outbound request"); };
  const methods: Array<[any, string, any]> = [
    [globalThis, "fetch", forbidden],
    [prisma, "$transaction", async (callback: any) => { const before = structuredClone(registration); try { return await callback(prisma); } catch (error) { Object.assign(registration, before); throw error; } }],
    [prisma, "$queryRaw", async (query: any) => { locks.push(query); return [{ id: "r1" }]; }],
    [prisma.registration, "findUniqueOrThrow", async () => structuredClone(registration)],
    [prisma.registration, "update", async ({ data }: any) => { Object.assign(registration, data); return structuredClone(registration); }],
    [prisma.paymentRecord, "create", async ({ data }: any) => { const row = { id: `p${registration.paymentRecords.length + 1}`, ...data }; registration.paymentRecords.push(row); return row; }],
    [prisma.paymentRecord, "update", async ({ where, data }: any) => { const row = registration.paymentRecords.find((r: any) => r.id === where.id); Object.assign(row, data); return row; }],
    [prisma, "$executeRaw", async (query: any) => { followUps.push(query); return 0; }],
    [prisma.auditLog, "create", async ({ data }: any) => { audit.push(data); return data; }]
  ];
  const originals = methods.map(([object, key]) => object[key]);
  methods.forEach(([object, key, value]) => object[key] = value);
  try { await run(registration, audit, locks, followUps); } finally { methods.forEach(([object, key], index) => object[key] = originals[index]); }
}

test("check upload validation requires an amount and number before any file is recorded", () => {
  for (const fields of [{ checkAmount: undefined }, { checkAmount: 0 }, { checkAmount: -1 }, { checkAmount: "" }, { checkAmount: NaN }, { checkAmount: Infinity }, { checkAmount: 1.001 }, { checkNumber: " " }, { checkNumber: "12\n13" }, { fileKey: "purchase-order/wrong.pdf" }]) assert.equal(registrationDocumentSchema.safeParse(proof(100, "1", fields)).success, false);
  assert.equal(registrationDocumentSchema.parse(proof(100.10, " 00123 ")).checkNumber, "00123");
  assert.equal(registrationDocumentSchema.safeParse({ type: "checkPayment", fileKey: null }).success, true);
  assert.equal(registrationDocumentSchema.safeParse({ type: "purchaseOrder", fileKey: "purchase-order/a", purchaseOrderNumber: "PO-1" }).success, true);
});

test("uploading partial and subsequent checks reconciles actual amounts and preserves billing method", async () => {
  await withLedger(async (registration, audit, locks, followUps) => {
    const partial = await updateRegistrationDocuments("r1", proof(100));
    assert.equal(partial.paymentStatus, "PARTIALLY_PAID");
    assert.equal(followUps.length, 0);
    assert.equal(registration.paymentRecords[0].amount, 100);
    assert.equal(readCheckPaymentProof(registration.paymentRecords[0].notes)?.checkNumber, "00123");
    const full = await recordCheckPaymentDocument("r1", proof(200, "00124", { fileKey: "check-payment/second.pdf" }));
    assert.equal(full.paymentStatus, "PAID");
    assert.equal(registration.paymentMethod, "PURCHASE_ORDER");
    assert.equal(registrationCollectedAmount(registration), 300);
    assert.equal(deriveRegistrationPaymentStatusFromRecords(registration.paymentRecords, undefined, 300), "PAID");
    assert.equal(audit.length, 2);
    assert.equal(followUps.length, 1);
    assert.ok(followUps[0].values.includes("r1"));
    assert.match(followUps[0].sql, /"status" = 'COMPLETED'/);
    assert.match(locks[0].sql, /FOR UPDATE/);
    assert.deepEqual(locks[0].values, ["r1"]);
  });
});

test("a matching total pays in full, and cents are compared without floating point errors", async () => {
  await withLedger(async registration => {
    registration.totalAmount = 0.30;
    await recordCheckPaymentDocument("r1", proof(0.10));
    const result = await recordCheckPaymentDocument("r1", proof(0.20, "second"));
    assert.equal(result.paymentStatus, "PAID");
  });
  await withLedger(async registration => {
    const result = await recordCheckPaymentDocument("r1", proof(300));
    assert.equal(result.paymentStatus, "PAID");
  });
});

test("replacing, correcting, and retrying a check never count it twice", async () => {
  await withLedger(async registration => {
    await recordCheckPaymentDocument("r1", proof(300));
    await recordCheckPaymentDocument("r1", proof(300)); // retried request
    assert.equal(registration.paymentRecords.length, 1);
    await recordCheckPaymentDocument("r1", proof(80, "corrected", { checkPaymentRecordId: "p1", fileKey: "check-payment/replacement.pdf" }));
    assert.equal(registration.paymentRecords.length, 1);
    assert.equal(registration.paymentStatus, "PARTIALLY_PAID");
    assert.equal(registrationCollectedAmount(registration), 80);
    assert.equal(deriveRegistrationPaymentStatusFromRecords(registration.paymentRecords, undefined, 300), "PARTIALLY_PAID");
    assert.equal(readCheckPaymentProof(registration.paymentRecords[0].notes)?.fileKey, "check-payment/replacement.pdf");
    await recordCheckPaymentDocument("r1", proof(80, "CORRECTED")); // normalized check number retry
    assert.equal(registration.paymentRecords.length, 1);
  });
});

test("existing card payments count, while pending, refunded and cancelled records do not", async () => {
  await withLedger(async registration => {
    registration.paymentRecords = [{ id: "card", amount: 200, method: "CREDIT_CARD", status: "PAID" }, { id: "pending", amount: 300, status: "INVOICED" }, { id: "refund", amount: 500, status: "REFUNDED" }];
    const result = await recordCheckPaymentDocument("r1", proof(50));
    assert.equal(result.paymentStatus, "PARTIALLY_PAID");
    assert.equal(registrationCollectedAmount(registration), 250);
    assert.equal(deriveRegistrationPaymentStatusFromRecords(registration.paymentRecords, undefined, 300), "PARTIALLY_PAID");
    assert.equal(registration.paymentRecords[0].amount, 200);
    assert.equal(registration.paymentRecords[1].status, "INVOICED");
  });
});

test("legacy recorded checks can receive proof without recording the receipt again", async () => {
  await withLedger(async registration => {
    registration.paymentStatus = "PAID";
    registration.paymentRecords = [{ id: "legacy", amount: 300, method: "CHECK", status: "PAID", notes: "Deposited Monday" }];
    await recordCheckPaymentDocument("r1", proof(300, "987", { checkPaymentRecordId: "legacy" }));
    assert.equal(registration.paymentRecords.length, 1);
    assert.match(registration.paymentRecords[0].notes, /Deposited Monday/);
    assert.equal(registrationCollectedAmount(registration), 300);
  });
});

test("foreign IDs, duplicate check numbers and retired registrations cannot change the ledger", async () => {
  await withLedger(async registration => {
    await recordCheckPaymentDocument("r1", proof(100));
    await assert.rejects(recordCheckPaymentDocument("r1", proof(50, "other", { checkPaymentRecordId: "another-registration-payment" })), /no longer belongs/);
    await recordCheckPaymentDocument("r1", proof(100, "two"));
    await assert.rejects(recordCheckPaymentDocument("r1", proof(50, "two", { checkPaymentRecordId: "p1" })), /already recorded/);
    registration.status = "CANCELLED";
    await assert.rejects(recordCheckPaymentDocument("r1", proof()), /Reopen/);
    assert.equal(registration.paymentRecords.length, 2);
  });
});

test("unreconciled legacy invoice money and external payment changes require review", async () => {
  await withLedger(async registration => {
    registration.invoiceDrafts = [{ status: "SENT", paidAmount: 100 }];
    await assert.rejects(recordCheckPaymentDocument("r1", proof()), /avoid counting it twice/);
    assert.equal(registration.paymentRecords.length, 0);
    registration.invoiceDrafts = [];
    registration.paymentStatus = "PAID";
    await assert.rejects(recordCheckPaymentDocument("r1", proof()), /avoid counting it twice/);
    registration.paymentRecords = [{ id: "qb", method: "CHECK", amount: 300, status: "PAID", quickBooksPaymentRef: "external" }];
    await assert.rejects(recordCheckPaymentDocument("r1", proof(100, "123", { checkPaymentRecordId: "qb" })), /QuickBooks-linked/);
  });
});

test("removing a proof preserves received money and retained evidence", async () => {
  await withLedger(async registration => {
    await recordCheckPaymentDocument("r1", proof(300));
    const notes = registration.paymentRecords[0].notes;
    await updateRegistrationDocuments("r1", { type: "checkPayment", fileKey: null });
    assert.equal(registration.checkPaymentFileKey, null);
    assert.equal(registration.paymentStatus, "PAID");
    assert.equal(registration.paymentRecords[0].notes, notes);
    assert.equal(registrationCollectedAmount(registration), 300);
  });
});

test("metadata parsing is defensive and the preview subtracts a replaced receipt", () => {
  assert.equal(readCheckPaymentProof("ordinary notes"), null);
  assert.equal(readCheckPaymentProof("[mission-cohort-check:v1]{broken"), null);
  assert.equal(readCheckPaymentProof('[mission-cohort-check:v1]{"checkNumber":"1","fileKey":"some-other-prefix/secret"}'), null);
  const notes = checkPaymentNotes({ checkNumber: "001", fileKey: "check-payment/a", fileName: "a", contentType: "image/png" });
  assert.equal(readCheckPaymentProof(notes)?.checkNumber, "001");
  assert.deepEqual(checkReconciliationPreview(300, [{ id: "p1", amount: 300, status: "PAID" }], 80, "p1"), { collected: 80, balance: 220, status: "PARTIALLY_PAID" });
});

test("proof history cannot read a payment from a different registration", async () => {
  const originalRegistration = prisma.registration.findUniqueOrThrow, originalPayment = prisma.paymentRecord.findFirst;
  let scope: any;
  prisma.registration.findUniqueOrThrow = (async () => fixture()) as any;
  prisma.paymentRecord.findFirst = (async ({ where }: any) => { scope = where; return null; }) as any;
  try {
    const response = await getDocument(new Request("https://example.org/api/registration-documents?registrationId=r1&type=checkPayment&paymentRecordId=foreign"));
    assert.equal(response.status, 404);
    assert.deepEqual(scope, { id: "foreign", registrationId: "r1", method: "CHECK" });
  } finally { prisma.registration.findUniqueOrThrow = originalRegistration; prisma.paymentRecord.findFirst = originalPayment; }
});
