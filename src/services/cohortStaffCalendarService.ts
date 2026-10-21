import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertOutboundUnlocked } from "@/lib/outboundLock";
import { cancellationBlocksDelivery } from "@/modules/cohorts/cancellation";
import { getGoogleCalendarEvent, patchGoogleCalendarAttendees, planStaffCalendarGuests } from "@/modules/calendar";
import { getCohortCalendarStaffAttendees, getCohortEnrollmentCalendarAttendees, getConnectedGoogleCalendarAccessToken } from "./calendarService";
import { readCohortSupportTeam } from "./cohortSupportService";
import { assertCohortDeliveryAllowed, resolveGoogleCalendarSetup } from "./integrationSetupService";
import { logAuditEvent } from "./auditService";

const statePrefix = "cohort.staffCalendar.";
const normalize = (email: string) => email.trim().toLowerCase();
const reject = (message: string) => Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
type CalendarState = { status: string; managedEmails: string[]; lastAttemptAt?: string; lastVerifiedAt?: string; error?: string; checked?: number; updated?: number; pending?: number };
const emptyState: CalendarState = { status: "pending", managedEmails: [] };
const defaults = {
  client: prisma, getAccessToken: getConnectedGoogleCalendarAccessToken, getSetup: resolveGoogleCalendarSetup,
  getEvent: getGoogleCalendarEvent, patchAttendees: patchGoogleCalendarAttendees,
  assertDelivery: assertCohortDeliveryAllowed, assertUnlocked: assertOutboundUnlocked, audit: logAuditEvent,
  now: () => new Date()
};
type Dependencies = typeof defaults;

export async function getCohortStaffCalendarState(cohortId: string, client = prisma): Promise<CalendarState> {
  const setting = await client.appSetting.findUnique({ where: { key: `${statePrefix}${cohortId}` } });
  const value = setting?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...emptyState };
  const state = value as unknown as CalendarState;
  return { ...state, managedEmails: Array.isArray(state.managedEmails) ? state.managedEmails.filter((email) => typeof email === "string") : [] };
}

export async function syncCohortStaffCalendar(cohortId: string, overrides: Partial<Dependencies> = {}): Promise<CalendarState & { message?: string; details?: Array<{ sessionId: string; added: string[]; removed: string[] }> }> {
  const deps = { ...defaults, ...overrides };
  const { client } = deps;
  const lockKey = `cohort.staffCalendarLock.${cohortId}`;
  const token = randomUUID();
  const lock = await client.appSetting.findUnique({ where: { key: lockKey } });
  if (lock && lock.updatedAt > new Date(deps.now().getTime() - 5 * 60_000)) return { ...emptyState, status: "busy", message: "Calendar invitations are already being synced." };
  try {
    if (lock) {
      const claimed = await client.appSetting.updateMany({ where: { key: lockKey, updatedAt: lock.updatedAt }, data: { value: { token } } });
      if (claimed.count !== 1) return { ...emptyState, status: "busy", message: "Calendar invitations are already being synced." };
    } else await client.appSetting.create({ data: { key: lockKey, value: { token } } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ...emptyState, status: "busy", message: "Calendar invitations are already being synced." };
    throw error;
  }
  let state = await getCohortStaffCalendarState(cohortId, client);
  const writeState = async (changes: Partial<CalendarState>) => {
    state = { ...state, ...changes };
    await client.appSetting.upsert({ where: { key: `${statePrefix}${cohortId}` }, create: { key: `${statePrefix}${cohortId}`, value: { ...state } }, update: { value: { ...state } } });
  };
  try {
    const [cohort, team, staff, cancellation] = await Promise.all([
      client.cohort.findUnique({ where: { id: cohortId }, select: { id: true, status: true } }),
      readCohortSupportTeam(cohortId, client), getCohortCalendarStaffAttendees(cohortId, client),
      client.operationsTask.findUnique({ where: { id: `cohort-cancellation:${cohortId}` }, select: { status: true } })
    ]);
    if (!cohort) throw reject("Cohort not found.");
    if (cohort.status !== "PUBLISHED" || cancellationBlocksDelivery(cohortId, null, cancellation?.status)) {
      await writeState({ status: "paused", lastAttemptAt: deps.now().toISOString(), error: "Calendar invitation sync waits until the cohort is published and is not being cancelled." });
      return state;
    }
    // Persist ownership before touching Google, including removed support
    // assignments. A retry can finish cleanup after a partial provider failure.
    const managedEmails = [...new Set([...state.managedEmails, ...(team?.calendarHistoryEmails ?? []), ...staff.map((guest) => guest.email)])];
    await writeState({ status: "syncing", managedEmails, lastAttemptAt: deps.now().toISOString(), error: "" });
    const sessions = await client.cohortSession.findMany({
      where: { cohortId, startTime: { gt: deps.now() } },
      orderBy: { startTime: "asc" },
      include: { calendarEvents: { where: { provider: "google", providerEventId: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1 } }
    });
    const linked = sessions.filter((session) => session.calendarEvents[0]?.providerEventId);
    const pending = sessions.length - linked.length;
    const accessToken = linked.length ? await deps.getAccessToken() : "";
    const setup = linked.length ? await deps.getSetup() : null;
    if (linked.length && !setup?.calendarId) throw reject("Connect the Google Calendar used by these cohort sessions before syncing invitations.");
    const calendarId = setup?.calendarId ?? "";
    const planned = [];
    for (const session of linked) {
      const providerEventId = session.calendarEvents[0].providerEventId!;
      const event = await deps.getEvent({ accessToken, calendarId, providerEventId, maxAttendees: 2500 });
      if (!event) throw reject(`The calendar event for ${session.title} is missing; no replacement event was created.`);
      if (event.status === "cancelled") continue;
      if (event.attendeesOmitted || (event.attendees ?? []).some((guest) => !guest.email)) throw reject(`Google returned an incomplete guest list for ${session.title}. No guest lists were changed.`);
      if (!event.etag) throw reject(`The calendar event version for ${session.title} is missing.`);
      planned.push({ session, providerEventId, event });
    }
    const signature = (guests: typeof staff) => guests.map((guest) => guest.email).sort().join("|");
    let updated = 0;
    const details = [];
    for (const plan of planned) {
      const [currentTeam, currentStaff, currentSession, cancelling, enrolled] = await Promise.all([
        readCohortSupportTeam(cohortId, client), getCohortCalendarStaffAttendees(cohortId, client),
        client.cohortSession.findFirst({ where: { id: plan.session.id, cohortId, startTime: { gt: deps.now() }, cohort: { status: "PUBLISHED" }, calendarEvents: { some: { provider: "google", providerEventId: plan.providerEventId } } }, select: { id: true } }),
        client.operationsTask.findUnique({ where: { id: `cohort-cancellation:${cohortId}` }, select: { status: true } }),
        getCohortEnrollmentCalendarAttendees(cohortId, {}, client)
      ]);
      if (!currentSession || currentTeam?.revision !== team?.revision || signature(currentStaff) !== signature(staff) || cancellationBlocksDelivery(cohortId, null, cancelling?.status)) throw reject("The cohort, staff assignment, or session changed during calendar sync. Remaining events will be checked again on retry.");
      const organizerEmail = (plan.event as typeof plan.event & { organizer?: { email?: string } }).organizer?.email;
      const change = planStaffCalendarGuests({ current: plan.event.attendees ?? [], staff, previouslyManaged: managedEmails, enrolledEmails: enrolled.map((guest) => guest.email), organizerEmail });
      if (change.added.length || change.removed.length) {
        const recipients = [...new Set([...(plan.event.attendees ?? []).map((guest) => guest.email!), ...change.attendees.map((guest) => guest.email)])];
        await deps.assertDelivery("GOOGLE_CALENDAR", cohort.status, recipients);
        await deps.assertUnlocked({ channel: "GOOGLE_CALENDAR", action: "sync Thought Leader and support team invitations", entityType: "Cohort", entityId: cohortId, metadata: { cohortId, missingRecipients: [...change.added, ...change.removed], sendUpdates: "all" } });
        await deps.patchAttendees({ accessToken, calendarId, providerEventId: plan.providerEventId, etag: plan.event.etag!, attendees: change.attendees, sendUpdates: "all" });
        const verified = await deps.getEvent({ accessToken, calendarId, providerEventId: plan.providerEventId, maxAttendees: 2500 });
        if (!verified || verified.status === "cancelled" || verified.attendeesOmitted) throw reject("Unable to verify the updated calendar invitation.");
        const actual = new Map((verified.attendees ?? []).map((guest) => [normalize(guest.email ?? ""), guest]));
        if (change.attendees.some((guest) => !actual.has(normalize(guest.email))) || change.removed.some((email) => actual.has(email))) throw reject("Calendar guest verification failed; review the invitation before retrying.");
        for (const guest of plan.event.attendees ?? []) {
          if (change.removed.includes(normalize(guest.email!))) continue;
          if (guest.responseStatus && actual.get(normalize(guest.email!))?.responseStatus !== guest.responseStatus) throw reject("An existing guest’s RSVP changed during verification. Review the calendar invitation.");
        }
        updated += 1;
        await deps.audit({ entityType: "CohortSession", entityId: plan.session.id, action: "STAFF_CALENDAR_SYNCED", description: "Verified Thought Leader and support team calendar membership without replacing the event.", metadata: { cohortId, added: change.added, removed: change.removed, sendUpdates: "all" } });
      }
      details.push({ sessionId: plan.session.id, added: change.added, removed: change.removed });
    }
    await writeState({ status: pending ? "pending" : "synced", lastVerifiedAt: deps.now().toISOString(), checked: planned.length, updated, pending, error: pending ? "Sessions without linked Google invitations will include staff when their invitations are created." : "" });
    return { ...state, details };
  } catch (error) {
    await writeState({ status: "failed", lastAttemptAt: deps.now().toISOString(), error: error instanceof Error ? error.message : "Calendar sync failed." });
    return state;
  } finally {
    await client.appSetting.deleteMany({ where: { key: lockKey, value: { equals: { token } } } });
  }
}

// Only cohorts with support assignments or an explicit staff sync are scanned.
// Oldest attempts go first so a larger set of cohorts cannot starve a retry.
export async function processCohortStaffCalendarSyncs(limit = 3, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const settings = await deps.client.appSetting.findMany({ where: { OR: [{ key: { startsWith: "cohort.supportTeam." } }, { key: { startsWith: statePrefix } }] }, select: { key: true, value: true } });
  const ids = [...new Set(settings.map((setting) => setting.key.replace(/^(cohort\.supportTeam\.|cohort\.staffCalendar\.)/, "")))];
  const attempts = new Map(settings.filter((setting) => setting.key.startsWith(statePrefix)).map((setting) => [setting.key.slice(statePrefix.length), String((setting.value as { lastAttemptAt?: string })?.lastAttemptAt ?? "")]));
  const selected = ids.sort((a, b) => (attempts.get(a) ?? "").localeCompare(attempts.get(b) ?? "")).slice(0, Math.max(1, Math.min(5, limit)));
  const results = [];
  for (const cohortId of selected) results.push({ cohortId, ...await syncCohortStaffCalendar(cohortId, deps) });
  return results;
}
