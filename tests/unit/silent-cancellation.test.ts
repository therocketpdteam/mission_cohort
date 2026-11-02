import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";
import { cancellationNotificationMode, cohortCancellationRecipients, runCohortCancellationSteps } from "../../src/modules/cohorts/cancellation";
import { cancelCohortWithNotices, getCohortCancellationPreview } from "../../src/services/cohortCancellationService";
import { cancelRegistration, previewRegistrationCancellation } from "../../src/services/registrationService";
import { deleteGoogleCalendarEvent } from "../../src/modules/calendar/googleCalendarProvider";
import { assertCancellationDeliveryIdle } from "../../src/services/cancellationDeliveryService";

function replaceMethods(replacements: Array<[any, string, any]>) {
  const original = replacements.map(([target, key]) => target[key]);
  replacements.forEach(([target, key, value]) => { target[key] = value; });
  return () => replacements.forEach(([target, key], index) => { target[key] = original[index]; });
}

function fixture() {
  const participant = { id: "p1", registrationId: "r1", cohortId: "c1", firstName: "Avery", lastName: "Brooks", email: "avery@example.com", status: "REGISTERED" };
  const registration = {
    id: "r1", cohortId: "c1", status: "NEW", archivedAt: null, source: "manual", externalSource: null,
    primaryContactName: "Avery Brooks", primaryContactEmail: "avery@example.com", participantCount: 1,
    paymentStatus: "REFUNDED", paymentMethod: "CREDIT_CARD", totalAmount: 100, invoiceNumber: "INV-1", quickBooksInvoiceRef: null,
    participants: [participant], paymentRecords: [{ id: "pay1", status: "REFUNDED", amount: 100, method: "CREDIT_CARD" }],
    invoiceDrafts: [{ id: "invoice1", status: "DRAFT", paidAmount: 0, invoiceNumber: "INV-1", pdfFileKey: "saved-history.pdf", pdfUrl: "https://example.com/history.pdf", quickBooksInvoiceRef: null }],
    organization: { name: "Example District" }, communications: []
  };
  const cohort = { id: "c1", title: "Summer cohort", shortName: "Summer", status: "DRAFT", sessions: [], registrations: [registration] };
  return { cohort, registration, participant };
}

test("silent cancellation is explicit and never resolves notification recipients", async () => {
  assert.equal(cancellationNotificationMode(undefined), "notify");
  assert.equal(cancellationNotificationMode(undefined, "silent"), "silent");
  assert.throws(() => cancellationNotificationMode("false"), /notify or silent/);
  const f = fixture();
  assert.deepEqual(cohortCancellationRecipients([f.registration], "silent"), []);
  f.registration.primaryContactEmail = "";
  const client = { cohort: { findUniqueOrThrow: async () => f.cohort }, operationsTask: { findUnique: async () => null } } as any;
  const preview = await getCohortCancellationPreview("c1", client, { notificationMode: "silent" });
  assert.deepEqual(preview.notices, []);
  assert.deepEqual(preview.blockers, []);
});

test("silent workflow skips the notice step but still removes calendars before finalizing", async () => {
  const events: string[] = [];
  await runCohortCancellationSteps({
    preflight: async () => { events.push("check"); }, pauseReminders: async () => { events.push("pause"); },
    sendNotices: async () => { throw new Error("Silent cancellation must not send"); },
    removeCalendar: async () => { events.push("calendar"); }, finalize: async () => { events.push("cancelled"); }
  }, "silent");
  assert.deepEqual(events, ["check", "pause", "calendar", "cancelled"]);
});

test("Google event deletion explicitly uses none for silent mode and all for notified cancellation", async () => {
  const original = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async url => { urls.push(String(url)); return new Response(null, { status: 204 }); }) as typeof fetch;
  try {
    for (const sendUpdates of [false, true]) await deleteGoogleCalendarEvent({ accessToken: "test", calendarId: "test", providerEventId: "test", sendUpdates });
    assert.equal(new URL(urls[0]).searchParams.get("sendUpdates"), "none");
    assert.equal(new URL(urls[1]).searchParams.get("sendUpdates"), "all");
  } finally { globalThis.fetch = original; }
});

test("actual silent cohort service preserves refunds and sends or queues no customer communications", async () => {
  const f = fixture(), audit: any[] = [], outgoing: string[] = [], writes: any[] = [];
  const failOutbound = async () => { outgoing.push("outbound"); throw new Error("Unexpected outbound activity"); };
  const restore = replaceMethods([
    [globalThis, "fetch", failOutbound],
    [prisma, "$transaction", async (callback: any) => callback(prisma)],
    [prisma.cohort, "findUniqueOrThrow", async () => f.cohort],
    [prisma.cohort, "update", async ({ data }: any) => Object.assign(f.cohort, data)],
    [prisma.registration, "findMany", async () => [f.registration]],
    [prisma.registration, "updateMany", async ({ data }: any) => { Object.assign(f.registration, data); return { count: 1 }; }],
    [prisma.participant, "updateMany", async ({ where, data }: any) => { assert.deepEqual(where.registrationId.in, ["r1"]); Object.assign(f.participant, data); return { count: 1 }; }],
    [prisma.paymentRecord, "updateMany", async () => ({ count: 0 })],
    [prisma.invoiceDraft, "updateMany", async ({ data }: any) => { Object.assign(f.registration.invoiceDrafts[0], data); return { count: 1 }; }],
    [prisma.operationsTask, "findUnique", async () => null],
    [prisma.operationsTask, "upsert", async () => ({})],
    [prisma.operationsTask, "update", async () => ({})],
    [prisma.operationsTask, "updateMany", async () => ({ count: 1 })],
    [prisma.calendarEvent, "deleteMany", async () => ({ count: 0 })],
    [prisma.cohortCommunication, "count", async () => 0],
    [prisma.cohortCommunication, "updateMany", async (input: any) => { writes.push(input); return { count: 1 }; }],
    [prisma.cohortCommunication, "upsert", failOutbound],
    [prisma.cohortCommunication, "create", failOutbound],
    [prisma.integrationSyncJob, "count", async () => 0],
    [prisma.integrationSyncJob, "updateMany", async () => ({ count: 0 })],
    [prisma.integrationSyncJob, "create", failOutbound],
    [prisma.crmSyncEvent, "count", async () => 0],
    [prisma.crmSyncEvent, "updateMany", async () => ({ count: 0 })],
    [prisma.crmSyncEvent, "create", failOutbound],
    [prisma.auditLog, "create", async (input: any) => { audit.push(input.data); return {}; }]
  ]);
  try {
    const result = await cancelCohortWithNotices("c1", "actor", { notificationMode: "silent" });
    assert.equal(result.status, "CANCELLED"); assert.equal(f.registration.status, "CANCELLED");
    assert.equal(f.participant.status, "CANCELLED"); assert.equal(f.registration.paymentStatus, "REFUNDED");
    assert.equal(f.registration.paymentRecords[0].status, "REFUNDED");
    assert.equal(f.registration.invoiceDrafts[0].status, "VOIDED");
    assert.equal(f.registration.invoiceDrafts[0].pdfFileKey, "saved-history.pdf");
    assert.deepEqual(outgoing, []); assert.equal(writes[0].data.status, "CANCELLED");
    assert.equal(audit[0].metadata.notificationMode, "silent"); assert.equal(audit[0].metadata.notices, 0);
    const again = await cancelCohortWithNotices("c1", "actor", { notificationMode: "silent" });
    assert.equal(again.status, "CANCELLED"); assert.equal(audit.length, 1);
  } finally { restore(); }
});

test("registration silent preview does not require a POC email or promise a PDF attachment", async () => {
  const f = fixture(); f.registration.primaryContactEmail = "";
  const target = { ...f.registration, cohort: { ...f.cohort, sessions: [] } };
  const client = {
    registration: { findUniqueOrThrow: async () => target, findUnique: async () => target, findMany: async () => [] },
    cohort: { findUnique: async () => ({ presenter: { email: "tl@example.com" } }) }, appSetting: { findUnique: async () => null }
  } as any;
  const preview = await previewRegistrationCancellation("r1", client, { notificationMode: "silent" });
  assert.deepEqual(preview.blockers, []); assert.equal(preview.invoice.willAttachVoidedPdf, false);
  assert.equal(preview.effects.crmSyncQueued, false);
});

test("actual silent registration cancellation avoids email, PDF regeneration, CRM jobs, and external finance calls", async () => {
  const f = fixture(); f.registration.paymentStatus = "INVOICED"; f.registration.paymentRecords[0].status = "INVOICED";
  const registration = { ...f.registration, cohort: { ...f.cohort, sessions: [] } };
  const outgoing: string[] = [];
  const forbidden = async () => { outgoing.push("outbound"); throw new Error("Unexpected outbound activity"); };
  const restore = replaceMethods([
    [globalThis, "fetch", forbidden], [prisma, "$transaction", async (callback: any) => callback(prisma)],
    [prisma.registration, "findUniqueOrThrow", async () => registration],
    [prisma.registration, "findUnique", async () => registration],
    [prisma.registration, "findMany", async () => []],
    [prisma.registration, "update", async ({ data }: any) => Object.assign(registration, data)],
    [prisma.participant, "findMany", async () => registration.participants.filter(p => p.status === "REGISTERED")],
    [prisma.participant, "updateMany", async ({ data }: any) => { Object.assign(f.participant, data); return { count: 1 }; }],
    [prisma.paymentRecord, "updateMany", async ({ data }: any) => { Object.assign(registration.paymentRecords[0], data); return { count: 1 }; }],
    [prisma.invoiceDraft, "update", async ({ data }: any) => Object.assign(registration.invoiceDrafts[0], data)],
    [prisma.cohort, "findUnique", async () => ({ presenter: { email: "tl@example.com" } })],
    [prisma.cohortSession, "findMany", async () => []], [prisma.appSetting, "findUnique", async () => null],
    [prisma.operationsTask, "updateMany", async () => ({ count: 1 })],
    [prisma.cohortCommunication, "count", async () => 0],
    [prisma.cohortCommunication, "updateMany", async () => ({ count: 1 })],
    [prisma.cohortCommunication, "create", forbidden],
    [prisma.integrationSyncJob, "count", async () => 0],
    [prisma.integrationSyncJob, "updateMany", async () => ({ count: 0 })],
    [prisma.integrationSyncJob, "create", forbidden],
    [prisma.crmSyncEvent, "count", async () => 0],
    [prisma.crmSyncEvent, "updateMany", async () => ({ count: 0 })],
    [prisma.crmSyncEvent, "create", forbidden],
    [prisma.auditLog, "create", async () => ({})]
  ]);
  try {
    const result = await cancelRegistration("r1", { notificationMode: "silent" });
    assert.equal(result.status, "CANCELLED"); assert.equal(result.paymentStatus, "CANCELLED");
    assert.equal(f.participant.status, "CANCELLED"); assert.equal(registration.invoiceDrafts[0].status, "VOIDED");
    assert.equal(registration.invoiceDrafts[0].pdfFileKey, "saved-history.pdf");
    assert.equal(result.cancellation.communication, null); assert.equal(result.cancellation.communicationError, null);
    assert.equal(result.cancellation.invoiceError, null); assert.equal(result.cancellation.invoice, null);
    assert.deepEqual(outgoing, []);
  } finally { restore(); }
});

test("in-flight delivery blocks cancellation before any customer state is changed", async () => {
  for (const active of ["email", "job", "crm"]) {
    const restore = replaceMethods([
      [prisma.cohortCommunication, "count", async () => active === "email" ? 1 : 0],
      [prisma.integrationSyncJob, "count", async () => active === "job" ? 1 : 0],
      [prisma.crmSyncEvent, "count", async () => active === "crm" ? 1 : 0]
    ]);
    try { await assert.rejects(assertCancellationDeliveryIdle(["r1"], ["p1"]), /already in progress/); }
    finally { restore(); }
  }
});
