import assert from "node:assert/strict";
import test from "node:test";
import { getCohortCalendarAttendees, planFutureGoogleCalendarAttendeeRemoval } from "../../src/services/calendarService";
import { planStaffCalendarGuests } from "../../src/modules/calendar/attendees";
import { patchGoogleCalendarAttendees } from "../../src/modules/calendar/googleCalendarProvider";
import { getCohortStaffCalendarState, processCohortStaffCalendarSyncs, syncCohortStaffCalendar } from "../../src/services/cohortStaffCalendarService";
import { registrationCancellationAttendanceMessage } from "../../src/config/registrationCancellation";

const now = new Date("2026-10-21T18:00:00Z");
const memberId = "ae200000-0000-4000-8000-000000000001";
const revision = "ae200000-0000-4000-8000-000000000002";
const supportEmail = "support-person@example.com", tlEmail = "tl@example.com";
function fixture() {
  const settings = new Map<string, any>();
  settings.set("cohort.supportTeam.cohort-1", { key: "cohort.supportTeam.cohort-1", updatedAt: now, value: { revision, updatedById: "admin-1", members: [{ id: memberId, name: "Alex", email: supportEmail }], calendarHistoryEmails: [supportEmail] } });
  const cohort = { id: "cohort-1", status: "PUBLISHED", presenter: { email: tlEmail, firstName: "Maya", lastName: "Rivera" } };
  const registered = { id: "registration-1", cohortId: cohort.id, primaryContactEmail: "poc@example.com", primaryContactName: "POC", participantCount: 2, participants: [{ email: "learner@example.com", firstName: "Learner", lastName: "One", status: "REGISTERED" }] };
  const manual = { email: "manual@example.com", responseStatus: "tentative", optional: true, comment: "Keep this note", additionalGuests: 1 };
  const learner = { email: "learner@example.com", responseStatus: "accepted", displayName: "Learner One" };
  const sessions = [1, 2].map(i => ({ id: `session-${i}`, cohortId: cohort.id, title: `Session ${i}`, startTime: new Date(`2026-11-${i === 1 ? '12' : '19'}T16:00:00Z`), calendarEvents: [{ providerEventId: `event-${i}` }] }));
  const events: Record<string, any> = Object.fromEntries(sessions.map(s => [s.calendarEvents[0].providerEventId, { id: s.calendarEvents[0].providerEventId, etag: '"version-1"', status: "confirmed", organizer: { email: "organizer@example.com" }, attendees: [structuredClone(manual), structuredClone(learner)] }]));
  const state = { settings, cohort, registrations: [registered], sessions, events, patches: [] as any[], audits: [] as any[], permissionChecks: [] as any[], cancelled: false, tokenReads: 0, afterPatch: null as null | (() => void) };
  const client: any = {
    appSetting: {
      findUnique: async ({ where }: any) => settings.has(where.key) ? structuredClone(settings.get(where.key)) : null,
      findMany: async () => [...settings.values()].filter(s => s.key.startsWith('cohort.supportTeam.') || s.key.startsWith('cohort.staffCalendar.')).map(s => structuredClone(s)),
      create: async ({ data }: any) => { if (settings.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" }); const result = { ...structuredClone(data), updatedAt: now }; settings.set(data.key, result); return result; },
      updateMany: async ({ where, data }: any) => { const old = settings.get(where.key); if (!old || where.updatedAt?.getTime() !== old.updatedAt.getTime()) return { count: 0 }; settings.set(where.key, { ...old, ...structuredClone(data), updatedAt: now }); return { count: 1 }; },
      upsert: async ({ where, create, update }: any) => { const result = { ...(settings.get(where.key) ?? create), ...(settings.has(where.key) ? update : {}), updatedAt: now }; settings.set(where.key, structuredClone(result)); return result; },
      deleteMany: async ({ where }: any) => { const old = settings.get(where.key); if (old && JSON.stringify(old.value) === JSON.stringify(where.value.equals)) { settings.delete(where.key); return { count: 1 }; } return { count: 0 }; }
    },
    cohort: { findUnique: async ({ where }: any) => where.id === cohort.id ? structuredClone(cohort) : null },
    cohortSession: {
      findMany: async ({ where }: any) => state.sessions.filter(s => s.cohortId === where.cohortId && s.startTime > where.startTime.gt).map(s => structuredClone(s)),
      findFirst: async ({ where }: any) => {
        const found = state.sessions.find(s => s.id === where.id && s.startTime > where.startTime.gt && state.cohort.status === where.cohort.status && s.calendarEvents.some(e => e.providerEventId === where.calendarEvents.some.providerEventId));
        return found ? { id: found.id } : null;
      }
    },
    registration: {
      findMany: async ({ where, select }: any) => state.registrations.filter(r => r.cohortId === where.cohortId && r.id !== where.id?.not).map(r => ({ ...r, _count: { participants: r.participants.length }, participants: r.participants.filter(p => p.status === select.participants.where.status) })),
      findUnique: async ({ where }: any) => state.registrations.find(r => r.id === where.id)
    },
    operationsTask: { findUnique: async () => state.cancelled ? { status: "IN_PROGRESS" } : null }
  };
  const dependencies: any = {
    client, now: () => now,
    getAccessToken: async () => { state.tokenReads++; return "fake-token"; }, getSetup: async () => ({ calendarId: "organizer@example.com" }),
    getEvent: async ({ providerEventId }: any) => state.events[providerEventId] ? structuredClone(state.events[providerEventId]) : null,
    patchAttendees: async (request: any) => {
      const event = state.events[request.providerEventId];
      assert.equal(request.etag, event.etag); assert.equal(request.sendUpdates, "all");
      state.patches.push(structuredClone(request)); event.attendees = structuredClone(request.attendees); event.etag = `"version-${state.patches.length + 1}"`;
      state.afterPatch?.(); return { updated: true };
    },
    assertDelivery: async (...args: any[]) => { state.permissionChecks.push(args); }, assertUnlocked: async () => ({}), audit: async (entry: any) => { state.audits.push(entry); return null; }
  };
  const team = () => settings.get("cohort.supportTeam.cohort-1").value;
  const sync = () => syncCohortStaffCalendar(cohort.id, dependencies);
  return { state, dependencies, client, sync, team, manual, learner };
}

test("automatic invitations combine active learners, Thought Leader and support people without duplicate addresses", async () => {
  const f = fixture(); f.team().members.push({ id: "ae200000-0000-4000-8000-000000000003", name: "Duplicate TL", email: " TL@EXAMPLE.COM " });
  const guests = await getCohortCalendarAttendees("cohort-1", {}, f.client);
  assert.deepEqual(guests.map(g => g.email), ["learner@example.com", tlEmail, supportEmail]);
});

test("staff guest planning preserves manual guests, RSVP metadata, active learners and the organizer", () => {
  const current = [{ email: "manual@example.com", responseStatus: "accepted", optional: true, comment: "Keep", additionalGuests: 2 }, { email: "former@example.com", responseStatus: "tentative" }, { email: "still-enrolled@example.com", responseStatus: "accepted" }, { email: "organizer@example.com", organizer: true }];
  const result = planStaffCalendarGuests({ current, staff: [{ email: supportEmail }, { email: " SUPPORT-PERSON@EXAMPLE.COM " }], previouslyManaged: ["former@example.com", "still-enrolled@example.com", "organizer@example.com"], enrolledEmails: ["still-enrolled@example.com"] });
  assert.deepEqual(result.removed, ["former@example.com"]); assert.deepEqual(result.added, [supportEmail]);
  assert.deepEqual(result.attendees[0], current[0]); assert.equal(result.attendees.find(g => g.email === "still-enrolled@example.com")?.responseStatus, "accepted");
  assert.ok(result.attendees.some(g => g.email === "organizer@example.com"));
  assert.throws(() => planStaffCalendarGuests({ current: [{}], staff: [], previouslyManaged: [], enrolledEmails: [] }), /complete/);
});

test("staff sync adds the TL and support to existing future events, preserves guests and sends no duplicate updates on retry", async () => {
  const f = fixture(); f.state.sessions.push({ ...f.state.sessions[0], id: "past-session", startTime: new Date("2026-01-01T16:00:00Z"), calendarEvents: [{ providerEventId: "past-event" }] });
  const result = await f.sync(); assert.equal(result.status, "synced"); assert.equal(result.checked, 2); assert.equal(result.updated, 2); assert.equal(f.state.patches.length, 2);
  for (const patch of f.state.patches) {
    assert.deepEqual(patch.attendees.find((g: any) => g.email === f.manual.email), f.manual);
    assert.deepEqual(patch.attendees.find((g: any) => g.email === f.learner.email), f.learner);
    assert.deepEqual(new Set(patch.attendees.map((g: any) => g.email)), new Set([f.manual.email, f.learner.email, tlEmail, supportEmail]));
  }
  assert.equal(f.state.audits.length, 2);
  await f.sync(); assert.equal(f.state.patches.length, 2);
  assert.equal((await getCohortStaffCalendarState("cohort-1", f.client)).status, "synced");
});

test("removing a support assignment preserves a separate active enrollment, then removes only the former staff guest when that enrollment ends", async () => {
  const f = fixture(); await f.sync(); f.team().members = [];
  f.state.registrations[0].participants.push({ email: supportEmail, firstName: "Alex", lastName: "Support", status: "REGISTERED" });
  await f.sync(); assert.equal(f.state.patches.length, 2);
  f.state.registrations[0].participants.pop(); await f.sync(); assert.equal(f.state.patches.length, 4);
  assert.ok(f.state.events['event-1'].attendees.some((g: any) => g.email === tlEmail));
  assert.ok(f.state.events['event-1'].attendees.some((g: any) => g.email === f.manual.email));
  assert.ok(!f.state.events['event-1'].attendees.some((g: any) => g.email === supportEmail));
});

test("a Thought Leader who was previously support keeps their invitation and RSVP after the support assignment is removed", async () => {
  const f = fixture(); f.team().members[0].email = tlEmail; f.team().calendarHistoryEmails = [tlEmail];
  f.state.events['event-1'].attendees.push({ email: tlEmail, responseStatus: "declined" });
  await f.sync(); f.team().members = []; await f.sync();
  assert.equal(f.state.events['event-1'].attendees.find((g: any) => g.email === tlEmail).responseStatus, "declined");
});

test("registration cancellation retains staff-role attendance without claiming an active participant registration remains", async () => {
  const f = fixture(); f.state.registrations[0].participants[0].email = supportEmail;
  const plan = await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "cohort-1", registrationId: "registration-1" }, f.client);
  assert.deepEqual(plan.emailsToRemove, []); assert.deepEqual(plan.emailsKeptForActiveEnrollment, []); assert.deepEqual(plan.emailsKeptForStaffRole, [supportEmail]);
  const message = registrationCancellationAttendanceMessage({ participants: [{ name: "Alex", email: supportEmail }], requestedEmails: [supportEmail], emailsKeptForActiveEnrollment: [], emailsKeptForStaffRole: [supportEmail], primaryContactEmail: supportEmail });
  assert.ok(message.text.includes("support team role")); assert.ok(!message.text.includes("separate active enrollment"));
});

test("draft, cancelled and cancelling cohorts cannot send staff calendar updates", async () => {
  for (const condition of ['DRAFT','CANCELLED','COMPLETED','CANCELLING']) {
    const f = fixture(); if (condition === 'CANCELLING') f.state.cancelled = true; else f.state.cohort.status = condition;
    assert.equal((await f.sync()).status, "paused"); assert.equal(f.state.tokenReads, 0); assert.equal(f.state.patches.length, 0);
  }
});

test("missing, incomplete or unversioned Google events stop the batch before any mutation", async () => {
  for (const corrupt of [(f: ReturnType<typeof fixture>) => { delete f.state.events['event-2']; }, (f: ReturnType<typeof fixture>) => { f.state.events['event-2'].attendeesOmitted = true; }, (f: ReturnType<typeof fixture>) => { f.state.events['event-2'].attendees.push({ displayName: 'Missing email' }); }, (f: ReturnType<typeof fixture>) => { delete f.state.events['event-2'].etag; }]) {
    const f = fixture(); corrupt(f); assert.equal((await f.sync()).status, "failed"); assert.equal(f.state.patches.length, 0);
  }
});

test("cancelled Google events are never recreated and sessions without linked invites remain pending", async () => {
  const f = fixture(); f.state.events['event-1'].status = 'cancelled'; f.state.sessions[1].calendarEvents = [];
  const result = await f.sync(); assert.equal(result.status, 'pending'); assert.equal(result.pending, 1); assert.equal(f.state.patches.length, 0);
  const unlinked = fixture(); unlinked.state.sessions.forEach(s => { s.calendarEvents = []; }); await unlinked.sync(); assert.equal(unlinked.state.tokenReads, 0);
});

test("parallel calendar workers claim one lease and produce one update per changed event", async () => {
  const f = fixture(); const results = await Promise.all([f.sync(), f.sync()]);
  assert.equal(f.state.patches.length, 2); assert.ok(results.some(r => r.status === 'busy')); assert.ok(results.some(r => r.status === 'synced'));
  assert.ok(!f.state.settings.has('cohort.staffCalendarLock.cohort-1'));
});

test("an unexpired lease is respected and an abandoned lease can be retried", async () => {
  const f = fixture(); f.state.settings.set('cohort.staffCalendarLock.cohort-1', { key: 'cohort.staffCalendarLock.cohort-1', value: { token: 'another-worker' }, updatedAt: now });
  assert.equal((await f.sync()).status, 'busy'); assert.equal(f.state.patches.length, 0);
  f.state.settings.get('cohort.staffCalendarLock.cohort-1').updatedAt = new Date(now.getTime() - 6 * 60_000);
  assert.equal((await f.sync()).status, 'synced'); assert.equal(f.state.patches.length, 2);
});

test("support assignment changes during sync stop later events and a retry reconciles the partial result", async () => {
  const f = fixture(); f.state.afterPatch = () => { f.team().members = []; f.team().revision = 'ae200000-0000-4000-8000-000000000004'; f.state.afterPatch = null; };
  assert.equal((await f.sync()).status, 'failed'); assert.equal(f.state.patches.length, 1);
  await f.sync(); assert.ok(!f.state.events['event-1'].attendees.some((g: any) => g.email === supportEmail));
  assert.ok(!f.state.events['event-2'].attendees.some((g: any) => g.email === supportEmail));
});

test("safety checks cover every notified guest and failures leave calendar data untouched", async () => {
  const f = fixture(); f.dependencies.assertDelivery = async (_provider: any, _status: any, recipients: string[]) => { assert.ok(recipients.includes(f.manual.email)); assert.ok(recipients.includes(f.learner.email)); throw new Error('Outbound restricted'); };
  const result = await f.sync(); assert.equal(result.status, 'failed'); assert.match(result.error!, /restricted/); assert.equal(f.state.patches.length, 0);
});

test("a Google version conflict stops the batch and a later retry uses a fresh guest list", async () => {
  const f = fixture(); const patch = f.dependencies.patchAttendees;
  f.dependencies.patchAttendees = async () => { throw Object.assign(new Error('Event changed; retry with current version'), { status: 409 }); };
  assert.equal((await f.sync()).status, 'failed'); assert.equal(f.state.patches.length, 0);
  f.state.events['event-1'].attendees.push({ email: 'new-manual@example.com', responseStatus: 'accepted' });
  f.state.events['event-1'].etag = '"new-version"';
  f.dependencies.patchAttendees = patch;
  assert.equal((await f.sync()).status, 'synced');
  assert.ok(f.state.events['event-1'].attendees.some((guest: any) => guest.email === 'new-manual@example.com' && guest.responseStatus === 'accepted'));
});

test("the staff calendar job fairly rotates only support-configured or explicitly managed cohorts", async () => {
  const f = fixture(); f.state.cohort.status = 'DRAFT';
  for (const [id, attempt] of [['older','2026-10-20T12:00:00Z'],['newer','2026-10-21T12:00:00Z']]) f.state.settings.set(`cohort.staffCalendar.${id}`, { key: `cohort.staffCalendar.${id}`, value: { status: 'paused', managedEmails: [], lastAttemptAt: attempt }, updatedAt: now });
  f.state.settings.set('organization.invoiceProfile', { key: 'organization.invoiceProfile', value: { displayName: 'RocketPD' }, updatedAt: now });
  f.client.cohort.findUnique = async ({ where }: any) => ({ ...f.state.cohort, id: where.id });
  const results = await processCohortStaffCalendarSyncs(2, f.dependencies);
  assert.deepEqual(results.map(r => r.cohortId), ['cohort-1','older']); assert.ok(results.every(r => r.status === 'paused')); assert.equal(f.state.patches.length, 0);
});

test("staff Google PATCH uses all notifications, attendees only, and If-Match concurrency protection", async () => {
  const previous = globalThis.fetch; let request: any;
  globalThis.fetch = (async (url, init) => { request = { url: String(url), ...init }; return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    await patchGoogleCalendarAttendees({ accessToken: 'fake', calendarId: 'organizer@example.com', providerEventId: 'event/1', etag: '"version"', attendees: [{ email: supportEmail }], sendUpdates: 'all' });
    assert.equal(new URL(request.url).searchParams.get('sendUpdates'), 'all'); assert.equal(request.headers['If-Match'], '"version"'); assert.deepEqual(Object.keys(JSON.parse(request.body)), ['attendees']);
  } finally { globalThis.fetch = previous; }
});
