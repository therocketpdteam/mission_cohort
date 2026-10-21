import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { repairRegistrationCalendarAttendance } from "../../src/services/calendarAttendanceRepairService";
import { patchGoogleCalendarAttendeesSilently } from "../../src/modules/calendar/googleCalendarProvider";

const email = "j.mccann@sau33.com";
const input = { email, referenceInvoiceNumber: "KM-2026-454", apply: false };
type Dependencies = NonNullable<Parameters<typeof repairRegistrationCalendarAttendance>[1]>;
function fixture() {
  const registration = {
    id: "paid-individual", cohortId: "km", status: "CONFIRMED", archivedAt: null,
    paymentStatus: "PAID", participantCount: 1, primaryContactEmail: email, primaryContactName: "Joanne McCann", invoiceNumber: "KM-PAID-1",
    participants: [{ id: "joanne-paid", email, firstName: "Joanne", lastName: "McCann", status: "REGISTERED" }],
    cohort: { id: "km", title: "KM Fall 2026", status: "PUBLISHED" }
  };
  const other = { email: "other@example.com", displayName: "Other participant", responseStatus: "accepted", optional: true, comment: "Attending", additionalGuests: 1 };
  const events: Record<string, any> = {
    "event-1": { id: "event-1", status: "confirmed", etag: '"version-1"', attendees: [other] },
    "event-2": { id: "event-2", status: "confirmed", etag: '"version-2"', attendees: [other, { email, responseStatus: "accepted" }] }
  };
  const sessions = Object.keys(events).map((id, index) => ({ id: `session-${index + 1}`, title: `Session ${index + 1}`, startTime: new Date("2099-10-21T16:00:00Z"), calendarEvents: [{ providerEventId: id }] }));
  const patches: any[] = [], audits: any[] = [], queries: any[] = [];
  const refs = [{ cohortId: "km" }];
  const state = { eligibleAtApply: true, tokenReads: 0 };
  const dependencies = {
    client: {
      registration: {
        findMany: async (query: any) => {
          queries.push(query);
          if (query.select?.cohortId) return refs;
          assert.equal(query.where.cohortId, "km");
          assert.equal(query.where.archivedAt, null);
          assert.deepEqual(query.where.status, { not: "CANCELLED" });
          return registration.status !== "CANCELLED" && !registration.archivedAt && (!query.where.id || query.where.id === registration.id) ? [registration] : [];
        },
        findFirst: async (query: any) => {
          assert.equal(query.where.id, "paid-individual");
          assert.equal(query.where.paymentStatus, "PAID");
          assert.deepEqual(query.where.cohort.status.in, ["PUBLISHED", "ACTIVE"]);
          assert.equal(query.where.AND[0].OR[0].participants.some.status, "REGISTERED");
          assert.deepEqual(query.where.AND[0].OR[1].participants.none, {});
          return state.eligibleAtApply ? { id: registration.id } : null;
        }
      },
      cohortSession: { findMany: async (query: any) => {
        assert.equal(query.where.cohortId, "km");
        assert.ok(query.where.startTime.gt instanceof Date);
        return sessions;
      } }
    },
    getAccessToken: async () => { state.tokenReads += 1; return "server-only-test-token"; },
    getSetup: async () => ({ calendarId: "organizer@example.com" }),
    getEvent: async ({ providerEventId }: any) => events[providerEventId] ? structuredClone(events[providerEventId]) : null,
    patchAttendees: async (request: any) => {
      patches.push(request);
      assert.equal(request.etag, events[request.providerEventId].etag);
      events[request.providerEventId].attendees = structuredClone(request.attendees);
      return { updated: true };
    },
    assertAllowed: async (cohortId: string, registrationId: string, target: string) => {
      assert.equal(cohortId, "km"); assert.equal(registrationId, "paid-individual"); assert.equal(target, email);
    },
    audit: async (audit: any) => { audits.push(audit); return null; }
  } as unknown as Dependencies;
  return { dependencies, registration, events, sessions, patches, audits, queries, refs, state, other };
}

test("silent repair preview identifies the active paid registration and missing future attendance without mutations", async () => {
  const f = fixture();
  const result = await repairRegistrationCalendarAttendance(input, f.dependencies);
  assert.equal(result.registrationId, "paid-individual");
  assert.equal(result.paymentStatus, "PAID");
  assert.equal(result.futureSessions, 2);
  assert.equal(result.missingBeforeRepair, 1);
  assert.equal(result.communicationsSent, 0);
  assert.equal(result.registrationStatusesChanged, 0);
  assert.equal(result.billingRecordsChanged, 0);
  assert.equal(f.patches.length, 0);
  assert.equal(f.audits.length, 0);
  assert.equal(f.queries[0].where.primaryContactEmail.equals, email);
  assert.equal(f.queries[0].where.OR[0].invoiceNumber.equals, "KM-2026-454");
});

test("apply restores only the missing attendee, preserves existing RSVP details and records verified results", async () => {
  const f = fixture();
  const result = await repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, f.dependencies);
  assert.equal(result.restored, 1);
  assert.equal(f.patches.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.patches[0].attendees)), [f.other, { email, displayName: "Joanne McCann", responseStatus: "needsAction" }]);
  assert.equal(f.patches[0].providerEventId, "event-1");
  assert.deepEqual(result.details.map((detail) => detail.status), ["restored_and_verified", "already_present"]);
  assert.equal(f.events["event-2"].attendees[1].responseStatus, "accepted");
  assert.equal(result.sendUpdates, "none");
  assert.equal(result.communicationsSent, 0);
  assert.equal(f.audits[0].action, "CALENDAR_ATTENDANCE_REPAIRED");
  assert.equal(f.registration.status, "CONFIRMED");
  assert.equal(f.registration.paymentStatus, "PAID");
  const repeat = await repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, f.dependencies);
  assert.equal(repeat.restored, 0);
  assert.equal(repeat.missingBeforeRepair, 0);
  assert.equal(f.patches.length, 1);
});

test("apply requires the exact paid registration ID from preview", async () => {
  for (const registrationId of [undefined, "cancelled-bundle"]) {
    const f = fixture();
    await assert.rejects(repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId }, f.dependencies));
    assert.equal(f.patches.length, 0);
  }
});

test("cancelled, archived, unpaid and cancelled-cohort registrations cannot be repaired", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.registration.status = "CANCELLED"; },
    (f: ReturnType<typeof fixture>) => { f.registration.archivedAt = new Date() as any; },
    (f: ReturnType<typeof fixture>) => { f.registration.paymentStatus = "INVOICED"; },
    (f: ReturnType<typeof fixture>) => { f.registration.cohort.status = "CANCELLED"; },
    (f: ReturnType<typeof fixture>) => { f.registration.participants[0].status = "CANCELLED"; }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(repairRegistrationCalendarAttendance(input, f.dependencies), /active paid enrollment/);
    assert.equal(f.patches.length, 0);
  }
});

test("an active one-seat legacy registration can restore its POC only if it has no saved participants", async () => {
  const f = fixture(); f.registration.participants = [];
  const result = await repairRegistrationCalendarAttendance(input, f.dependencies);
  assert.equal(result.registrationId, "paid-individual");
  f.registration.participantCount = 2;
  await assert.rejects(repairRegistrationCalendarAttendance(input, f.dependencies), /active paid enrollment/);
});

test("ambiguous reference invoices cannot select a cohort for repair", async () => {
  const f = fixture(); f.refs.push({ cohortId: "another-cohort" });
  await assert.rejects(repairRegistrationCalendarAttendance(input, f.dependencies), /exactly one cohort/);
  assert.equal(f.state.tokenReads, 0);
});

test("incomplete, missing, cancelled or unversioned events stop repair before any event changes", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.events["event-2"].attendeesOmitted = true; },
    (f: ReturnType<typeof fixture>) => { delete f.events["event-2"]; },
    (f: ReturnType<typeof fixture>) => { f.events["event-2"].status = "cancelled"; },
    (f: ReturnType<typeof fixture>) => { delete f.events["event-1"].etag; }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, f.dependencies));
    assert.equal(f.patches.length, 0);
  }
});

test("an enrollment change or existing outbound lock prevents attendee restoration", async () => {
  const changed = fixture(); changed.state.eligibleAtApply = false;
  await assert.rejects(repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, changed.dependencies), /changed during repair/);
  assert.equal(changed.patches.length, 0);
  const locked = fixture(); locked.dependencies.assertAllowed = async () => { throw new Error("Outbound locked"); };
  await assert.rejects(repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, locked.dependencies), /Outbound locked/);
  assert.equal(locked.patches.length, 0);
});

test("repair cannot report success without rereading Google and finding the target and existing guests", async () => {
  const f = fixture(); f.dependencies.patchAttendees = async () => ({ updated: true });
  await assert.rejects(repairRegistrationCalendarAttendance({ ...input, apply: true, registrationId: "paid-individual" }, f.dependencies), /verification failed/);
  assert.equal(f.audits.length, 0);
});

test("no future linked sessions causes no calendar connection or attendee mutation", async () => {
  const f = fixture(); f.sessions.splice(0);
  const result = await repairRegistrationCalendarAttendance(input, f.dependencies);
  assert.equal(result.futureSessions, 0);
  assert.equal(f.state.tokenReads, 0);
  assert.equal(f.patches.length, 0);
});

test("Google repair PATCH sends no notifications, uses If-Match, and changes only attendees", async () => {
  const originalFetch = globalThis.fetch;
  let captured: any;
  globalThis.fetch = (async (url, init) => {
    captured = { url: String(url), ...init };
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await patchGoogleCalendarAttendeesSilently({ accessToken: "fake-token", calendarId: "organizer@example.com", providerEventId: "event/1", etag: '"version"', attendees: [{ email, responseStatus: "needsAction" }] });
    assert.equal(new URL(captured.url).searchParams.get("sendUpdates"), "none");
    assert.equal(captured.method, "PATCH");
    assert.equal(captured.headers["If-Match"], '"version"');
    assert.deepEqual(Object.keys(JSON.parse(captured.body)), ["attendees"]);
    assert.deepEqual(JSON.parse(captured.body).attendees, [{ email, responseStatus: "needsAction" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("Google repair refuses missing versions and does not overwrite concurrent edits", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("{}", { status: 412 }); }) as typeof fetch;
  const request = { accessToken: "fake-token", calendarId: "organizer@example.com", providerEventId: "event-1", etag: "", attendees: [{ email }] };
  try {
    await assert.rejects(patchGoogleCalendarAttendeesSilently(request), /current event version/);
    assert.equal(calls, 0);
    await assert.rejects(patchGoogleCalendarAttendeesSilently({ ...request, etag: '"old"' }), /changed during repair/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("repair endpoint rejects a missing or invalid job secret before accessing app data", () => {
  for (const secret of ["", "test-only-job-secret"]) {
    const script = `import('./src/app/api/jobs/repair-calendar-attendance/route.ts').then(async (module) => { const POST = module.POST ?? module.default.POST; const result = await POST(new Request('http://localhost/api/jobs/repair-calendar-attendance', {method:'POST', headers:{authorization:'Bearer invalid'}, body:'{}'})); if(result.status!==403) process.exit(1); console.log(result.status); });`;
    const output = execFileSync(process.execPath, ["--import", "tsx", "-e", script], { cwd: process.cwd(), env: { ...process.env, CRON_SECRET: secret }, encoding: "utf8" });
    assert.match(output, /403/);
  }
});
