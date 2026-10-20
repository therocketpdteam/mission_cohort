import assert from "node:assert/strict";
import test from "node:test";
import { getCohortCancellationPreview } from "../../src/services/cohortCancellationService";

function fixture() {
  return {
    id: "cohort-1", title: "DP Fall 2026", status: "PUBLISHED", sessions: [],
    registrations: [{
      id: "r1", status: "CONFIRMED", source: "manual", externalSource: null,
      primaryContactName: "Avery Brooks", primaryContactEmail: "avery@example.com",
      organization: { name: "Northview School District" }, participantCount: 2,
      totalAmount: 1590, paymentMethod: "PURCHASE_ORDER", paymentStatus: "INVOICED",
      invoiceNumber: "DP-2026-437", purchaseOrderNumber: "PO-123",
      participants: [
        { id: "p1", firstName: "Avery", lastName: "Brooks", email: "avery@example.com", status: "REGISTERED" },
        { id: "p2", firstName: "Jordan", lastName: "Kim", email: "jordan@example.com", status: "REGISTERED" }
      ],
      paymentRecords: [] as Array<{ amount: number; status: string; method: string }>,
      invoiceDrafts: [{ id: "i1", invoiceNumber: "DP-2026-437", status: "SENT", paidAmount: 0 }]
    }]
  };
}

function preview(cohort = fixture()) {
  const readOnlyClient = {
    cohort: { findUniqueOrThrow: async () => cohort },
    operationsTask: { findUnique: async () => null }
  } as unknown as NonNullable<Parameters<typeof getCohortCancellationPreview>[1]>;
  return getCohortCancellationPreview("cohort-1", readOnlyClient);
}

test("cancellation preview resolves actual POC and participant emails without any sending or database mutations", async () => {
  const plan = await preview();
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.notices.length, 2);
  const poc = plan.notices.find((notice) => notice.role === "poc")!;
  const participant = plan.notices.find((notice) => notice.role === "participant")!;
  assert.match(poc.bodyText, /Hello Avery,/);
  assert.match(poc.bodyText, /DP-2026-437 will be voided/);
  assert.match(poc.bodyHtml, /<table/);
  assert.match(poc.journeyKey, /r1:avery@example.com$/);
  assert.match(participant.bodyText, /Hello Jordan,/);
  assert.doesNotMatch(participant.bodyText, /invoice|refund|PO-123/i);
});

test("preview treats an invoice marked paid as received even if its paid amount was not populated", async () => {
  const cohort = fixture();
  cohort.registrations[0].invoiceDrafts[0].status = "PAID";
  const poc = (await preview(cohort)).notices.find((notice) => notice.role === "poc")!;
  assert.match(poc.bodyText, /We received payment/);
  assert.doesNotMatch(poc.bodyText, /not received payment|will be voided/);
});

test("preview uses actual collected payment method and partial amount instead of PO billing arrangement", async () => {
  const cohort = fixture();
  cohort.registrations[0].paymentRecords = [{ amount: 200, status: "PAID", method: "CHECK" }];
  const poc = (await preview(cohort)).notices.find((notice) => notice.role === "poc")!;
  assert.match(poc.bodyText, /payment by check/);
  assert.match(poc.bodyText, /remaining unpaid balance will be cancelled/);
  assert.doesNotMatch(poc.bodyText, /will be voided/);
});

test("preview blocks a missing POC email instead of silently omitting that registration", async () => {
  const cohort = fixture();
  cohort.registrations[0].primaryContactEmail = "";
  const plan = await preview(cohort);
  assert.ok(plan.blockers.some((blocker) => /valid email/.test(blocker)));
});
