import { ParticipantStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOutboundUnlocked } from "@/lib/outboundLock";
import { getGoogleCalendarEvent, patchGoogleCalendarAttendeesSilently } from "@/modules/calendar/googleCalendarProvider";
import { getConnectedGoogleCalendarAccessToken } from "./calendarService";
import { assertOutboundRecipientsAllowed, resolveGoogleCalendarSetup } from "./integrationSetupService";
import { logAuditEvent } from "./auditService";

const normalize = (value: string) => value.trim().toLowerCase();
const reject = (message: string) => Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
const defaultDependencies = {
  client: prisma,
  getAccessToken: getConnectedGoogleCalendarAccessToken,
  getSetup: resolveGoogleCalendarSetup,
  getEvent: getGoogleCalendarEvent,
  patchAttendees: patchGoogleCalendarAttendeesSilently,
  assertAllowed: async (cohortId: string, registrationId: string, email: string) => {
    await assertOutboundUnlocked({
      channel: "GOOGLE_CALENDAR", action: "silently restore one actively enrolled attendee",
      entityType: "Registration", entityId: registrationId,
      metadata: { cohortId, missingRecipients: [email], sendUpdates: "none" }
    });
    await assertOutboundRecipientsAllowed("GOOGLE_CALENDAR", [email]);
  },
  audit: logAuditEvent
};

// Uses the app's existing Calendar connection. It deliberately never plans
// registration journeys, sends fallback files, or calls any email service.
export async function repairRegistrationCalendarAttendance(input: {
  email: string;
  referenceInvoiceNumber: string;
  registrationId?: string;
  apply: boolean;
}, dependencies: typeof defaultDependencies = defaultDependencies) {
  const { client } = dependencies;
  const email = normalize(input.email);
  const references = await client.registration.findMany({
    where: {
      primaryContactEmail: { equals: email, mode: "insensitive" },
      OR: [
        { invoiceNumber: { equals: input.referenceInvoiceNumber, mode: "insensitive" } },
        { invoiceDrafts: { some: { invoiceNumber: { equals: input.referenceInvoiceNumber, mode: "insensitive" } } } }
      ]
    },
    select: { cohortId: true }
  });
  const cohortIds = [...new Set(references.map((registration) => registration.cohortId))];
  if (cohortIds.length !== 1) throw reject("The reference invoice must identify exactly one cohort for this contact.");
  const cohortId = cohortIds[0];
  const activeWhere = {
    cohortId, archivedAt: null, status: { not: RegistrationStatus.CANCELLED },
    ...(input.registrationId ? { id: input.registrationId } : {}),
    OR: [
      { primaryContactEmail: { equals: email, mode: "insensitive" as const } },
      { participants: { some: { email: { equals: email, mode: "insensitive" as const }, status: ParticipantStatus.REGISTERED } } }
    ]
  };
  const registrations = await client.registration.findMany({
    where: activeWhere,
    include: { participants: true, cohort: true }
  });
  const eligible = registrations.filter((registration) => (
    registration.paymentStatus === PaymentStatus.PAID &&
    ["PUBLISHED", "ACTIVE"].includes(registration.cohort.status) &&
    (registration.participants.some((participant) => normalize(participant.email) === email && participant.status === ParticipantStatus.REGISTERED)
      || (registration.participantCount === 1 && registration.participants.length === 0 && normalize(registration.primaryContactEmail) === email))
  ));
  if (eligible.length !== 1) throw reject("Exactly one active paid enrollment with an eligible participant is required. Review the registration first.");
  const registration = eligible[0];
  if (input.apply && input.registrationId !== registration.id) throw reject("Apply requires the exact active registration ID returned by preview.");
  const name = registration.participants.find((participant) => normalize(participant.email) === email);
  const displayName = name ? [name.firstName, name.lastName].filter(Boolean).join(" ") : registration.primaryContactName;
  const sessions = await client.cohortSession.findMany({
    where: {
      cohortId, startTime: { gt: new Date() },
      calendarEvents: { some: { provider: "google", providerEventId: { not: null } } }
    },
    orderBy: { sessionNumber: "asc" },
    include: { calendarEvents: { where: { provider: "google", providerEventId: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1 } }
  });
  const setup = sessions.length ? await dependencies.getSetup() : null;
  const accessToken = sessions.length ? await dependencies.getAccessToken() : "";
  if (sessions.length && !setup?.calendarId) throw reject("The connected Google calendar is not configured.");
  const calendarId = setup?.calendarId ?? "";
  const planned = [];
  // Read every event before making a change. Never repair a missing/cancelled
  // event or replace a guest list Google reported as incomplete.
  for (const session of sessions) {
    const providerEventId = session.calendarEvents[0]?.providerEventId;
    if (!providerEventId) throw reject("A linked Google event is required for every repair target.");
    const event = await dependencies.getEvent({ accessToken, calendarId, providerEventId, maxAttendees: 2500 });
    if (!event || event.status === "cancelled") throw reject(`The Google event for ${session.title} is missing or cancelled.`);
    if (event.attendeesOmitted) throw reject(`Google omitted attendees for ${session.title}; repair stopped before changing the guest list.`);
    const attendees = event.attendees ?? [];
    if (attendees.some((attendee) => !attendee.email)) throw reject(`A guest address is missing for ${session.title}; repair stopped before changing the guest list.`);
    const present = attendees.some((attendee) => normalize(attendee.email ?? "") === email);
    if (!present && !event.etag) throw reject(`The current event version is missing for ${session.title}.`);
    planned.push({ session, providerEventId, event, attendees, present });
  }
  let added = 0;
  const details = [];
  for (const plan of planned) {
    if (input.apply && !plan.present) {
      // Recheck enrollment immediately before each mutation. This also makes a
      // rerun after an interrupted request safe without reopening a cancellation.
      const stillActive = await client.registration.findFirst({
        where: {
          ...activeWhere, id: registration.id, paymentStatus: PaymentStatus.PAID,
          cohort: { status: { in: ["PUBLISHED", "ACTIVE"] } },
          AND: [{ OR: [
            { participants: { some: { email: { equals: email, mode: "insensitive" }, status: ParticipantStatus.REGISTERED } } },
            { participantCount: 1, primaryContactEmail: { equals: email, mode: "insensitive" }, participants: { none: {} } }
          ] }]
        },
        select: { id: true }
      });
      if (!stillActive) throw reject("The paid registration changed during repair. No further events were modified.");
      await dependencies.assertAllowed(cohortId, registration.id, email);
      const attendees = plan.attendees.filter((attendee) => attendee.email).map((attendee) => ({
        email: attendee.email!, displayName: attendee.displayName, responseStatus: attendee.responseStatus,
        optional: attendee.optional, comment: attendee.comment, additionalGuests: attendee.additionalGuests, resource: attendee.resource
      }));
      await dependencies.patchAttendees({
        accessToken, calendarId, providerEventId: plan.providerEventId, etag: plan.event.etag!,
        attendees: [...attendees, { email, displayName, responseStatus: "needsAction" }]
      });
      const verified = await dependencies.getEvent({ accessToken, calendarId, providerEventId: plan.providerEventId, maxAttendees: 2500 });
      if (!verified || verified.status === "cancelled" || verified.attendeesOmitted) throw reject("Unable to verify the repaired event's complete attendee list.");
      const verifiedEmails = new Set((verified.attendees ?? []).map((attendee) => normalize(attendee.email ?? "")));
      if (!verifiedEmails.has(email) || attendees.some((attendee) => !verifiedEmails.has(normalize(attendee.email)))) {
        throw reject("Calendar verification failed after repair. Review the guest list before retrying.");
      }
      added += 1;
    }
    details.push({ sessionId: plan.session.id, title: plan.session.title, startTime: plan.session.startTime,
      status: plan.present ? "already_present" : input.apply ? "restored_and_verified" : "missing",
      responseStatus: plan.present ? plan.attendees.find((attendee) => normalize(attendee.email ?? "") === email)?.responseStatus ?? "unknown" : input.apply ? "needsAction" : null });
  }
  const result = {
    mode: input.apply ? "apply" : "preview", email, cohortId, cohortTitle: registration.cohort.title,
    registrationId: registration.id, invoiceNumber: registration.invoiceNumber, paymentStatus: registration.paymentStatus,
    futureSessions: sessions.length, missingBeforeRepair: planned.filter((plan) => !plan.present).length,
    restored: added, sendUpdates: "none", communicationsSent: 0, registrationStatusesChanged: 0, billingRecordsChanged: 0, details
  };
  if (input.apply) await dependencies.audit({
    entityType: "Registration", entityId: registration.id, action: "CALENDAR_ATTENDANCE_REPAIRED",
    description: "Verified and silently restored one paid participant's attendance on existing future Google events.", metadata: result
  });
  return result;
}
