import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma";
import { reconcilePaidPaymentFollowUps } from "../../src/services/paymentFollowUpService";
import { syncRegistrationPaymentStatusFromPaymentRecords } from "../../src/services/paymentService";
import { listOpenOperationsTasks, listTasksForCohort } from "../../src/services/operationsTaskService";
import { getRegistrationById } from "../../src/services/registrationService";
import { isOpenRegistrationFollowUp, PAYMENT_STATUS_FOLLOW_UP_TITLE } from "../../src/lib/paymentFollowUps";
import { registrationFinanceAlerts } from "../../src/lib/registrationFinanceAlerts";

const task = (id: string, paymentStatus: string, extra: object = {}) => ({ id, registrationId: `r-${id}`, cohortId: "c1", category: "PAYMENT_FOLLOW_UP", title: PAYMENT_STATUS_FOLLOW_UP_TITLE, status: "OPEN", completedAt: null as Date | null, registration: { paymentStatus }, ...extra });
async function ledger(rows: any[]) {
  const db = new PGlite(), queries: any[] = [];
  await db.exec(`CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','INVOICED','PARTIALLY_PAID','PAID','REFUNDED','CANCELLED','UNCOLLECTIBLE');
    CREATE TYPE "TaskStatus" AS ENUM ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED');
    CREATE TABLE "Registration" ("id" text PRIMARY KEY, "paymentStatus" "PaymentStatus", "paymentMethod" text, "totalAmount" numeric(10,2));
    CREATE TABLE "PaymentRecord" ("registrationId" text, "status" "PaymentStatus", "amount" numeric(10,2));
    CREATE TABLE "InvoiceDraft" ("registrationId" text, "status" text, "paidAmount" numeric(10,2));
    CREATE TABLE "OperationsTask" ("id" text PRIMARY KEY, "registrationId" text, "cohortId" text, "category" text, "title" text, "status" "TaskStatus", "completedAt" timestamptz, "updatedAt" timestamptz);
    CREATE INDEX ON "OperationsTask" ("status"); CREATE INDEX ON "OperationsTask" ("category"); CREATE INDEX ON "PaymentRecord" ("registrationId"); CREATE INDEX ON "InvoiceDraft" ("registrationId");`);
  for (const row of rows) {
    if (row.registration) {
      const r = row.registration;
      await db.query('INSERT INTO "Registration" VALUES ($1,$2,$3,$4)', [row.registrationId, r.paymentStatus, r.paymentMethod ?? "INVOICE", r.totalAmount ?? 300]);
      for (const payment of r.paymentRecords ?? []) await db.query('INSERT INTO "PaymentRecord" VALUES ($1,$2,$3)', [row.registrationId, payment.status, payment.amount]);
      for (const invoice of r.invoiceDrafts ?? []) await db.query('INSERT INTO "InvoiceDraft" VALUES ($1,$2,$3)', [row.registrationId, invoice.status, invoice.paidAmount]);
    }
    await db.query('INSERT INTO "OperationsTask" VALUES ($1,$2,$3,$4,$5,$6,$7,null)', [row.id,row.registrationId,row.cohortId,row.category,row.title,row.status,row.completedAt]);
  }
  const client = { $executeRaw: async (query: any) => {
    queries.push(query);
    const result = await db.query(query.text, query.values);
    const updated = await db.query<any>('SELECT "id", "status", "completedAt" FROM "OperationsTask"');
    for (const row of rows) Object.assign(row, updated.rows.find(item => item.id === row.id));
    return result.affectedRows ?? 0;
  } } as any;
  return { client, queries, close: () => db.close(), db };
}

function replace(methods: Array<[any, string, any]>) {
  const originals = methods.map(([target, key]) => target[key]); methods.forEach(([target, key, value]) => target[key] = value);
  return () => methods.forEach(([target, key], index) => target[key] = originals[index]);
}

test("paid intake follow-ups resolve, while partial/unpaid/refund/custom work stays open", async () => {
  const rows = [task("paid", "PAID"), task("progress", "PAID", { status: "IN_PROGRESS" }), task("partial", "PARTIALLY_PAID"), task("invoice", "INVOICED"), task("pending", "PENDING"), task("refunded", "REFUNDED"), task("refund", "PAID", { title: "Arrange cancellation refund and review invoice balances" }), task("qb", "PAID", { title: "Review linked QuickBooks invoice after cohort cancellation" }), task("custom", "PAID", { title: "Review payment dispute" }), task("roster", "PAID", { category: "PARTICIPANT_LIST" }), task("cancelled", "PAID", { status: "CANCELLED" }), task("unlinked", "PAID", { registration: null })];
  const { client, queries, close } = await ledger(rows);
  assert.equal((await reconcilePaidPaymentFollowUps({}, client)).count, 2);
  assert.equal(rows[0].status, "COMPLETED"); assert.ok(rows[0].completedAt instanceof Date);
  assert.equal(rows[1].status, "COMPLETED");
  assert.ok(rows.slice(2).every(row => row.status === (row.id === "cancelled" ? "CANCELLED" : "OPEN")));
  assert.ok(queries[0].values.includes(PAYMENT_STATUS_FOLLOW_UP_TITLE));
  const completedAt = rows[0].completedAt;
  assert.equal((await reconcilePaidPaymentFollowUps({}, client)).count, 0);
  assert.deepEqual(rows[0].completedAt, completedAt);
  await close();
});

test("reconciliation scopes cannot complete unrelated registrations or cohorts", async () => {
  const rows = [task("a", "PAID"), task("b", "PAID", { cohortId: "c2" })];
  const { client, close } = await ledger(rows);
  assert.equal((await reconcilePaidPaymentFollowUps({ registrationIds: [] }, client)).count, 0);
  assert.equal((await reconcilePaidPaymentFollowUps({ registrationId: "r-a" }, client)).count, 1);
  assert.equal(rows[1].status, "OPEN");
  assert.equal((await reconcilePaidPaymentFollowUps({ cohortId: "c1" }, client)).count, 0);
  assert.equal((await reconcilePaidPaymentFollowUps({ registrationIds: ["r-b"] }, client)).count, 1);
  await close();
});

test("payment synchronization resolves stale follow-ups even when PAID status was already saved", async () => {
  const rows = [task("paid", "PAID")], { client, close } = await ledger(rows);
  const restore = replace([
    [prisma.registration, "findUnique", async () => ({ totalAmount: 300, paymentStatus: "PAID", paymentRecords: [{ amount: 300, status: "PAID" }] })],
    [prisma, "$executeRaw", client.$executeRaw],
    [globalThis, "fetch", async () => { throw new Error("No email, CRM, or external requests expected"); }]
  ]);
  try { assert.equal(await syncRegistrationPaymentStatusFromPaymentRecords("r-paid"), "PAID"); assert.equal(rows[0].status, "COMPLETED"); } finally { restore(); await close(); }
});

test("partial payment synchronization leaves payment follow-up actionable", async () => {
  const rows = [task("partial", "PARTIALLY_PAID")], { client, queries, close } = await ledger(rows);
  const restore = replace([
    [prisma.registration, "findUnique", async () => ({ totalAmount: 300, paymentStatus: "PARTIALLY_PAID", paymentRecords: [{ amount: 100, status: "PARTIALLY_PAID" }] })],
    [prisma, "$executeRaw", client.$executeRaw]
  ]);
  try { assert.equal(await syncRegistrationPaymentStatusFromPaymentRecords("r-partial"), "PARTIALLY_PAID"); assert.equal(queries.length, 0); assert.equal(rows[0].status, "OPEN"); } finally { restore(); await close(); }
});

test("registration detail, cohort tasks and open-task reads repair legacy paid follow-ups", async () => {
  const rows = [task("paid", "PAID"), task("other", "PAID", { cohortId: "c2" })], { client, close, db } = await ledger(rows);
  const restore = replace([
    [prisma, "$executeRaw", client.$executeRaw],
    [prisma.operationsTask, "findMany", async ({ where }: any) => rows.filter(row => (!where.cohortId || row.cohortId === where.cohortId) && (!where.status || where.status.in.includes(row.status)))],
    [prisma.registration, "findUnique", async () => ({ id: "r-paid", paymentStatus: "PAID", operationsTasks: rows.filter(row => row.registrationId === "r-paid") })],
    [globalThis, "fetch", async () => { throw new Error("No delivery should occur"); }]
  ]);
  try {
    const result = await getRegistrationById("r-paid"); assert.equal(result!.operationsTasks[0].status, "COMPLETED"); assert.equal(rows[1].status, "OPEN");
    assert.equal((await listTasksForCohort("c2"))[0].status, "COMPLETED");
    rows[1].status = "OPEN";
    await db.query('UPDATE "OperationsTask" SET "status" = $1 WHERE "id" = $2', ["OPEN", "other"]);
    assert.deepEqual(await listOpenOperationsTasks(), []);
    assert.equal(rows[1].status, "COMPLETED");
  } finally { restore(); await close(); }
});

test("the client excludes cancelled/resolved follow-ups without hiding refund work", () => {
  assert.equal(isOpenRegistrationFollowUp(task("a", "PAID"), { paymentStatus: "PAID" }), false);
  assert.equal(isOpenRegistrationFollowUp(task("a", "PARTIALLY_PAID"), { paymentStatus: "PARTIALLY_PAID" }), true);
  assert.equal(isOpenRegistrationFollowUp(task("a", "PAID", { status: "CANCELLED" }), { paymentStatus: "INVOICED" }), false);
  assert.equal(isOpenRegistrationFollowUp(task("a", "PAID", { title: "Arrange cancellation refund and review invoice balances" }), { paymentStatus: "PAID" }), true);
});

test("finance card warnings reflect missing documents and outstanding invoice work", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const registration = { totalAmount: 300, paymentStatus: "INVOICED", paymentMethod: "PURCHASE_ORDER", status: "CONFIRMED" };
  assert.deepEqual(registrationFinanceAlerts(registration, now), { documents: 1, invoice: 1 });
  assert.deepEqual(registrationFinanceAlerts({ ...registration, purchaseOrderFileKey: "purchase-order/a", purchaseOrderNumber: "PO1", invoiceDrafts: [{ status: "SENT", totalAmount: 300, paidAmount: 0, dueDate: "2026-11-10" }] }, now), { documents: 0, invoice: 1 });
  assert.deepEqual(registrationFinanceAlerts({ ...registration, paymentStatus: "PAID" }, now), { documents: 0, invoice: 0 });
  assert.equal(registrationFinanceAlerts({ ...registration, paymentMethod: "CHECK", paymentStatus: "PAID" }, now).documents, 1);
  assert.equal(registrationFinanceAlerts({ ...registration, paymentMethod: "CHECK", paymentStatus: "PAID", checkPaymentFileKey: "check-payment/a" }, now).documents, 0);
  assert.equal(registrationFinanceAlerts({ ...registration, paymentStatus: "PAID", paymentRecords: [{ amount: 350, status: "PAID" }] }, now).invoice, 1);
  assert.equal(registrationFinanceAlerts({ ...registration, paymentStatus: "PAID", quickBooksSyncError: "Review connection" }, now).invoice, 1);
  assert.deepEqual(registrationFinanceAlerts({ ...registration, status: "CANCELLED", paymentStatus: "REFUNDED" }, now), { documents: 0, invoice: 0 });
});


test("receipt and invoice settlement match displayed finance without double-counting mirrored amounts", async () => {
  const rows = [
    task("receipts", "INVOICED", { registration: { paymentStatus: "INVOICED", totalAmount: 300, paymentRecords: [{ status: "PARTIALLY_PAID", amount: 150 }, { status: "PARTIALLY_PAID", amount: 150 }] } }),
    task("invoices", "INVOICED", { registration: { paymentStatus: "INVOICED", totalAmount: 300, invoiceDrafts: [{ status: "PAID", paidAmount: 200 }, { status: "SENT", paidAmount: 100 }] } }),
    task("mirrored", "PARTIALLY_PAID", { registration: { paymentStatus: "PARTIALLY_PAID", totalAmount: 200, paymentRecords: [{ status: "PARTIALLY_PAID", amount: 100 }], invoiceDrafts: [{ status: "SENT", paidAmount: 100 }] } }),
    task("voided", "INVOICED", { registration: { paymentStatus: "INVOICED", totalAmount: 300, invoiceDrafts: [{ status: "VOIDED", paidAmount: 300 }] } }),
    task("refund-receipt", "REFUNDED", { registration: { paymentStatus: "REFUNDED", totalAmount: 300, paymentRecords: [{ status: "PAID", amount: 300 }] } }),
    task("zero", "PENDING", { registration: { paymentStatus: "PENDING", totalAmount: 0 } }),
    task("comped", "PENDING", { registration: { paymentStatus: "PENDING", paymentMethod: "COMPED", totalAmount: 300, paymentRecords: [{ status: "PAID", amount: 300 }] } })
  ];
  const { client, close } = await ledger(rows);
  try {
    assert.equal((await reconcilePaidPaymentFollowUps({}, client)).count, 2);
    for (const row of rows) {
      const settled = ["receipts", "invoices"].includes(row.id);
      assert.equal(row.status, settled ? "COMPLETED" : "OPEN");
      assert.equal(isOpenRegistrationFollowUp({ ...row, status: "OPEN" }, row.registration), !settled);
    }
  } finally { await close(); }
});
