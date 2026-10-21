import assert from "node:assert/strict";
import test from "node:test";
import { buildEmailDelivery } from "../../src/services/emailService";
import { renderMergeFields, validateMergeFields } from "../../src/modules/email/mergeFields";
import { isSupportReminder, parseSupportJourneyKey, renderSupportReminder, supportJourneyKey, supportReminderTemplate, supportReminderTime, supportReminderWindow } from "../../src/modules/email/supportReminders";
import { getCohortSupportTeam, reconcileCohortSupportReminders, saveCohortSupportTeam } from "../../src/services/cohortSupportService";
import { deliverSupportReminder } from "../../src/services/supportReminderDeliveryService";

const now = new Date("2026-10-22T14:00:00Z");
const memberId = "ae200000-0000-4000-8000-000000000001";
function fixture() {
  const state = {
    team: null as any,
    cohort: { id: "cohort-1", title: "Support QA cohort", status: "PUBLISHED", defaultTimezone: "America/New_York", presenter: { firstName: "Maya", lastName: "Rivera" } },
    sessions: [{ id: "session-1", cohortId: "cohort-1", title: "Leadership session", startTime: new Date("2026-10-24T16:00:00Z"), timezone: "America/New_York", meetingUrl: "https://zoom.us/j/local-qa" }],
    records: new Map<string, any>(), events: [] as any[], audits: [] as any[], deliveries: [] as any[], cancelled: false, clock: now
  };
  const matches = (record: any, where: any) => (!where.id || record.id === where.id) && (!where.cohortId || where.cohortId === record.cohortId)
    && (where.sentAt !== null || !record.sentAt)
    && (!where.status || (typeof where.status === "string" ? record.status === where.status : where.status.in.includes(record.status)))
    && (!where.journeyKey || (record.journeyKey.startsWith(where.journeyKey.startsWith) && !where.journeyKey.notIn?.includes(record.journeyKey)));
  const client: any = {
    appSetting: {
      findUnique: async () => state.team ? { value: structuredClone(state.team) } : null,
      create: async ({ data }: any) => { if (state.team) throw Object.assign(new Error("duplicate"), { code: "P2002" }); state.team = structuredClone(data.value); return data; },
      updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where.value.path, ["revision"]);
        if (where.value.equals !== state.team?.revision) return { count: 0 };
        state.team = structuredClone(data.value); return { count: 1 };
      }
    },
    cohort: { findUnique: async ({ where }: any) => where.id === state.cohort.id ? { ...state.cohort, sessions: state.sessions } : null },
    cohortSession: { findUnique: async ({ where }: any) => {
      const session = state.sessions.find((session) => session.id === where.id);
      return session ? { ...session, cohort: { ...state.cohort } } : null;
    } },
    operationsTask: { findUnique: async () => state.cancelled ? { status: "IN_PROGRESS" } : null },
    cohortCommunication: {
      findMany: async ({ where }: any) => [...state.records.values()].filter((record) => matches(record, where)).map((record) => ({ ...record })),
      upsert: async ({ where, create }: any) => {
        const existing = [...state.records.values()].find((record) => record.journeyKey === where.journeyKey);
        if (existing) return { ...existing };
        const record = { id: `communication-${state.records.size + 1}`, sentAt: null, ...create };
        state.records.set(record.id, record); return { ...record };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0; for (const record of state.records.values()) if (matches(record, where)) { Object.assign(record, data); count += 1; }
        return { count };
      },
      update: async ({ where, data }: any) => { const record = state.records.get(where.id); Object.assign(record, data); return { ...record }; },
      findUniqueOrThrow: async ({ where }: any) => ({ ...state.records.get(where.id) })
    },
    emailEvent: { create: async ({ data }: any) => { state.events.push(data); return data; } },
    $transaction: async (callback: any) => callback(client)
  };
  const save = (members: any[], expected = state.team?.revision ?? null) => saveCohortSupportTeam("cohort-1", { revision: expected, members }, "admin-1", { client, now: state.clock, audit: (event) => { state.audits.push(event); } });
  const reconcile = () => reconcileCohortSupportReminders("cohort-1", client, state.clock);
  const dependencies = {
    client, now: () => state.clock,
    assertDelivery: async () => undefined,
    send: async (request: any) => { state.deliveries.push(request); return { providerMessageId: "provider-qa", renderedSubject: request.subject, renderedBodyHtml: request.bodyHtml, renderedBodyText: request.bodyText }; }
  } as any;
  const records = () => [...state.records.values()];
  const record = (kind = "24h") => records().find((record) => record.journeyKey.endsWith(`:${kind}`));
  return { state, client, save, reconcile, dependencies, records, record };
}

for (const kind of ["24h", "60m"] as const) test(`${kind} support email merges the assigned person, Thought Leader, local session time and preparation checklist`, () => {
  const template = supportReminderTemplate(kind);
  assert.deepEqual(validateMergeFields(template.subject + template.bodyText), []);
  const context = { support: { name: "Alex" }, cohort: { title: "QA cohort", presenterName: "Maya Rivera" }, session: { title: "Leadership", startTime: "2026-10-24T16:00:00Z", timezone: "America/New_York", meetingUrl: "https://zoom.us/j/qa" } };
  const message = renderSupportReminder(kind, context);
  for (const value of ["Hello Alex", "Maya Rivera", "October 24, 2026", "12:00 PM", "Eastern Time", "https://zoom.us/j/qa", "15–20 minutes", "5–10 minutes", "Gerardo or Chris", "screen sharing", "Share sound", "cloud recording"]) assert.ok(message.bodyText.includes(value), value);
  assert.ok(!message.bodyText.includes("{{"));
  assert.ok(!message.bodyText.includes("invoice"));
  assert.ok(!message.bodyText.includes("registration confirmed"));
  assert.equal(renderMergeFields(template.subject, context).warnings.length, 0);
  const hostile = renderSupportReminder(kind, { ...context, support: { name: '<img src=x onerror="bad()">' } });
  assert.ok(!hostile.bodyHtml.includes("<img"));
  assert.ok(hostile.bodyHtml.includes("&lt;img"));
  assert.deepEqual(buildEmailDelivery({ recipients: ["alex@example.com"], subject: message.subject, html: message.bodyHtml }, { environment: "production" }).to, ["alex@example.com"]);
});

test("support reminder offsets use exact elapsed hours and reject early or stale windows", () => {
  const start = new Date("2026-11-02T16:00:00Z");
  assert.equal(supportReminderTime(start, "24h").toISOString(), "2026-11-01T16:00:00.000Z");
  assert.equal(supportReminderTime(start, "60m").toISOString(), "2026-11-02T15:00:00.000Z");
  assert.equal(supportReminderWindow(start, "24h", new Date("2026-11-01T15:59:59Z")), "early");
  assert.equal(supportReminderWindow(start, "24h", new Date("2026-11-01T16:00:00Z")), "due");
  assert.equal(supportReminderWindow(start, "24h", new Date("2026-11-02T15:00:00Z")), "expired");
  assert.equal(supportReminderWindow(start, "60m", new Date("2026-11-02T15:00:00Z")), "due");
  assert.equal(supportReminderWindow(start, "60m", start), "expired");
});

test("support journey keys identify only one cohort, session, support assignment and reminder", () => {
  assert.deepEqual(parseSupportJourneyKey(supportJourneyKey("cohort", memberId, "session", "24h")), { cohortId: "cohort", memberId, sessionId: "session", kind: "24h" });
  assert.equal(parseSupportJourneyKey("session-template:session:DAY_BEFORE_REMINDER"), null);
  assert.equal(parseSupportJourneyKey("cohort:x:support:y:z:invalid"), null);
  assert.equal(isSupportReminder("cohort:x:support:y:z:invalid"), true);
});

test("unassigned cohorts never get support reminders", async () => {
  const f = fixture(); await f.reconcile();
  assert.equal(f.records().length, 0);
  assert.deepEqual((await getCohortSupportTeam("cohort-1", f.client)).members, []);
});

test("saving two support people creates two private reminders each per session without participant records", async () => {
  const f = fixture(); f.state.sessions.push({ ...f.state.sessions[0], id: "session-2", startTime: new Date("2026-11-01T16:00:00Z") });
  const result = await f.save([{ name: "Alex", email: " Alex@Example.com " }, { name: "Blair", email: "blair@example.com" }]);
  assert.equal(result.members[0].email, "alex@example.com");
  assert.equal(f.records().length, 8);
  assert.ok(f.records().every((record) => record.status === "SCHEDULED" && record.recipientScope === "CUSTOM" && record.recipientEmails.length === 1 && !record.registrationId && !record.participantId && !record.templateId));
  assert.deepEqual(new Set(f.records().map((record) => record.recipientEmails[0])), new Set(["alex@example.com", "blair@example.com"]));
  assert.equal(f.state.deliveries.length, 0); assert.equal(f.state.audits.length, 1);
  await f.reconcile(); assert.equal(f.records().length, 8);
});

test("duplicate and invalid support addresses are rejected before any queue or settings change", async () => {
  for (const members of [[{ name: "A", email: "same@example.com" }, { name: "B", email: "SAME@EXAMPLE.COM" }], [{ name: "A", email: "invalid" }], [{ name: "", email: "valid@example.com" }]]) {
    const f = fixture(); await assert.rejects(f.save(members)); assert.equal(f.state.team, null); assert.equal(f.records().length, 0);
  }
});

test("stale revisions and unknown member IDs cannot overwrite another support assignment", async () => {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }]);
  await assert.rejects(f.save([], null), /changed since/);
  await assert.rejects(f.save([{ id: memberId, name: "Other", email: "other@example.com" }]), /changed since/);
  assert.equal(f.state.team.members[0].name, "Alex");
});

test("a competing save that wins after the initial read prevents any queue update", async () => {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }]);
  const original = structuredClone(f.state.team);
  const originalQueue = structuredClone(f.records());
  f.client.appSetting.updateMany = async () => ({ count: 0 });
  await assert.rejects(f.save([]), /changed since/);
  assert.deepEqual(f.state.team, original);
  assert.deepEqual(f.records(), originalQueue);
});

test("removing support people cancels pending and failed mail while preserving sent history", async () => {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }, { name: "Blair", email: "blair@example.com" }]);
  const sent = f.record(); sent.status = "SENT"; sent.sentAt = now;
  f.records()[1].status = "FAILED";
  await f.save([]);
  assert.equal(sent.status, "SENT");
  assert.ok(f.records().filter((record) => record.id !== sent.id).every((record) => record.status === "CANCELLED"));
  assert.equal(f.state.deliveries.length, 0);
});

test("name edits preserve delivery identity; email edits replace the assignment and cancel old pending recipients", async () => {
  const f = fixture(); const original = await f.save([{ name: "Alex", email: "alex@example.com" }]);
  const renamed = await f.save([{ ...original.members[0], name: "Alexander" }]);
  assert.equal(renamed.members[0].id, original.members[0].id); assert.equal(f.records().length, 2);
  const changed = await f.save([{ ...renamed.members[0], email: "new@example.com" }]);
  assert.notEqual(changed.members[0].id, original.members[0].id);
  assert.equal(f.records().length, 4);
  assert.ok(f.records().filter((record) => record.recipientEmails[0] === "alex@example.com").every((record) => record.status === "CANCELLED"));
});

test("late assignments schedule only future reminder times and never send catch-up messages", async () => {
  for (const minutes of [90, 30]) {
    const f = fixture(); f.state.clock = new Date(f.state.sessions[0].startTime.getTime() - minutes * 60_000);
    await f.save([{ name: "Alex", email: "alex@example.com" }]);
    assert.equal(f.record("24h").status, "SKIPPED");
    assert.equal(f.record("60m").status, minutes === 90 ? "SCHEDULED" : "SKIPPED");
    assert.equal(f.state.deliveries.length, 0);
  }
});

test("session rescheduling updates unsent reminders but does not repeat already sent reminders", async () => {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }]);
  const sent = f.record(); sent.status = "SENT"; sent.sentAt = now;
  const originalSentTime = sent.scheduledFor;
  f.state.sessions[0].startTime = new Date("2026-11-07T18:00:00Z");
  await f.reconcile(); assert.equal(f.records().length, 2); assert.equal(sent.scheduledFor, originalSentTime);
  assert.equal(f.record("60m").scheduledFor.toISOString(), "2026-11-07T17:00:00.000Z");
  f.state.sessions = []; await f.reconcile(); assert.equal(f.record("60m").status, "CANCELLED"); assert.equal(sent.status, "SENT");
});

test("moving a session too close to now skips newly past reminder times rather than sending them immediately", async () => {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }]);
  f.state.sessions[0].startTime = new Date(now.getTime() + 30 * 60_000);
  await f.reconcile();
  assert.ok(f.records().every((record) => record.status === "SKIPPED"));
  assert.equal(f.state.deliveries.length, 0);
});

test("draft cohorts hold support reminders, publishing schedules them, and cancelled cohorts cannot revive mail", async () => {
  const f = fixture(); f.state.cohort.status = "DRAFT";
  await f.save([{ name: "Alex", email: "alex@example.com" }]); assert.ok(f.records().every((record) => record.status === "DRAFT"));
  f.state.cohort.status = "PUBLISHED"; await f.reconcile(); assert.ok(f.records().every((record) => record.status === "SCHEDULED"));
  f.state.cohort.status = "CANCELLED"; await f.reconcile(); assert.ok(f.records().every((record) => record.status === "CANCELLED"));
  f.state.cohort.status = "PUBLISHED"; await f.reconcile(); assert.ok(f.records().every((record) => record.status === "CANCELLED"));
});

async function dueFixture(kind: "24h" | "60m" = "24h") {
  const f = fixture(); await f.save([{ name: "Alex", email: "alex@example.com" }]);
  f.state.clock = supportReminderTime(f.state.sessions[0].startTime, kind);
  return f;
}

for (const kind of ["24h", "60m"] as const) test(`${kind} delivery sends only to the current support assignment with live session details`, async () => {
  const f = await dueFixture(kind); const result = await deliverSupportReminder({ ...f.record(kind) }, f.dependencies);
  assert.equal(result.status, "SENT"); assert.equal(f.state.events.length, 1); assert.equal(f.state.deliveries.length, 1);
  assert.equal(f.state.deliveries[0].to, "alex@example.com");
  assert.ok(f.state.deliveries[0].bodyText.includes("Hello Alex"));
  assert.ok(f.state.deliveries[0].bodyText.includes("Maya Rivera"));
  assert.ok(!f.state.deliveries[0].bodyText.includes("{{"));
});

test("two scheduler workers and repeated calls cannot send the same support reminder twice", async () => {
  const f = await dueFixture(); const original = { ...f.record() };
  await Promise.all([deliverSupportReminder(original, f.dependencies), deliverSupportReminder(original, f.dependencies)]);
  await deliverSupportReminder(original, f.dependencies);
  assert.equal(f.state.deliveries.length, 1); assert.equal(f.state.events.length, 1);
});

test("removed assignments, changed recipients, unpublished cohorts, cancellation and expired sessions stop delivery", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.team.members = []; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.record().recipientEmails = ["participant@example.com"]; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.record().recipientEmails.push("other@example.com"); },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.record().recipientScope = "ALL_PARTICIPANTS"; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.cohort.status = "DRAFT"; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.cancelled = true; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.clock = f.state.sessions[0].startTime; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.sessions = []; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.sessions[0].startTime = new Date("2026-11-20T17:00:00Z"); }
  ]) {
    const f = await dueFixture(); change(f);
    const result = await deliverSupportReminder({ ...f.record() }, f.dependencies);
    assert.equal(result.status, "SKIPPED"); assert.equal(f.state.deliveries.length, 0);
  }
});

test("membership is checked again after claiming the reminder", async () => {
  const f = await dueFixture(); const updateMany = f.client.cohortCommunication.updateMany;
  f.client.cohortCommunication.updateMany = async (query: any) => {
    const result = await updateMany(query); if (query.data.status === "SENDING") f.state.team.members = []; return result;
  };
  assert.equal((await deliverSupportReminder({ ...f.record() }, f.dependencies)).status, "SKIPPED");
  assert.equal(f.state.deliveries.length, 0);
});

test("early reminders, invalid meeting links, outbound blocks and mismatched cohort keys never send", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.clock = now; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.sessions[0].meetingUrl = ""; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.state.sessions[0].meetingUrl = "javascript:bad()"; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.dependencies.assertDelivery = async () => { throw new Error("Outbound locked"); }; },
    (f: Awaited<ReturnType<typeof dueFixture>>) => { f.record().cohortId = "other-cohort"; }
  ]) {
    const f = await dueFixture(); change(f); await assert.rejects(deliverSupportReminder({ ...f.record() }, f.dependencies)); assert.equal(f.state.deliveries.length, 0);
  }
});

test("a failed support send is held for review rather than retried automatically", async () => {
  const f = await dueFixture(); let attempts = 0;
  f.dependencies.send = async () => { attempts += 1; throw new Error("Provider response uncertain"); };
  await assert.rejects(deliverSupportReminder({ ...f.record() }, f.dependencies), /uncertain/);
  assert.equal(f.record().status, "FAILED");
  await assert.rejects(deliverSupportReminder({ ...f.record() }, f.dependencies), /review/);
  await f.reconcile(); assert.equal(f.record().status, "FAILED"); assert.equal(attempts, 1);
});
