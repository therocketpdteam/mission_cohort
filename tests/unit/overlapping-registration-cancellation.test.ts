import assert from "node:assert/strict";
import test from "node:test";
import { planFutureGoogleCalendarAttendeeRemoval, removeFutureGoogleCalendarAttendees } from "../../src/services/calendarService";
import { previewRegistrationCancellation } from "../../src/services/registrationService";
import { cancelRegistrationJourneys } from "../../src/services/registrationJourneyService";
import { registrationCancellationAttendanceMessage } from "../../src/config/registrationCancellation";

const joanne = "j.mccann@sau33.com";
const angela = "a.parson@sau33.com";
const bundle = {
  id: "bundle", cohortId: "km", status: "CONFIRMED", archivedAt: null,
  participantCount: 2, primaryContactName: "Joanne McCann", primaryContactEmail: joanne,
  participants: [
    { id: "bundle-joanne", firstName: "Joanne", lastName: "McCann", email: joanne, status: "REGISTERED" },
    { id: "bundle-angela", firstName: "Angela", lastName: "Parsons", email: angela, status: "REGISTERED" }
  ],
  totalAmount: 1590, paymentStatus: "INVOICED", paymentMethod: "INVOICE", invoiceNumber: "KM-2026-454",
  organization: { name: "Raymond High School" }, paymentRecords: [],
  invoiceDrafts: [{ id: "bundle-invoice", invoiceNumber: "KM-2026-454", status: "SENT", paidAmount: 0 }],
  communications: [{ id: "bundle-reminder", subject: "Bundle reminder", status: "SCHEDULED" }],
  cohort: { id: "km", title: "Rethinking teacher supervision", shortName: "KM Fall 2026", sessions: [{ id: "session-1", sessionNumber: 1, title: "Session 1", startTime: new Date("2099-10-01T16:00:00Z") }] }
};
const individual = {
  id: "individual", cohortId: "km", status: "CONFIRMED", archivedAt: null,
  participantCount: 1, primaryContactName: "Joanne McCann", primaryContactEmail: joanne,
  participants: [{ id: "individual-joanne", firstName: "Joanne", lastName: "McCann", email: " J.MCCANN@SAU33.COM ", status: "REGISTERED" }]
};

type Enrollment = typeof individual;
function readOnlyClient(others: Enrollment[] = [individual], target = bundle) {
  const queries: any[] = [];
  const client = {
    cohort: { findUnique: async () => ({ presenter: { email: "tl@example.com", firstName: "Thought", lastName: "Leader" } }) },
    appSetting: { findUnique: async () => null },
    registration: {
      findUnique: async ({ where }: any) => where.id === target.id ? target : null,
      findUniqueOrThrow: async () => target,
      findMany: async ({ where, select }: any) => {
        queries.push({ where, select });
        // Apply the actual enrollment constraints to a small in-memory fixture.
        return [target, ...others].filter((row) => row.cohortId === where.cohortId && row.id !== where.id?.not && !row.archivedAt && row.status !== where.status.not)
          .map((row) => ({ ...row, _count: { participants: row.participants.length }, participants: row.participants.filter((participant) => participant.status === select.participants.where.status && !select.participants.where.id?.notIn.includes(participant.id)) }));
      }
    },
    participant: {
      findMany: async ({ where }: any) => [target, ...others].filter((row) => row.cohortId === where.cohortId).flatMap((row) => row.participants).filter((participant) => where.id.in.includes(participant.id))
    }
  };
  return { client: client as unknown as NonNullable<Parameters<typeof planFutureGoogleCalendarAttendeeRemoval>[1]>, queries };
}

test("cancelling a bundle removes Angela but keeps Joanne through her separate individual enrollment", async () => {
  const { client, queries } = readOnlyClient();
  const plan = await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", registrationId: "bundle" }, client);
  assert.deepEqual(plan.requestedEmails, [joanne, angela]);
  assert.deepEqual(plan.emailsToRemove, [angela]);
  assert.deepEqual(plan.emailsKeptForActiveEnrollment, [joanne]);
  assert.deepEqual(queries[0].where, { cohortId: "km", archivedAt: null, status: { not: "CANCELLED" }, id: { not: "bundle" } });
  assert.equal(queries[0].select.participants.where.status, "REGISTERED");
});

test("cancelled, archived, other-cohort and no-longer-registered enrollments do not protect attendance", async () => {
  for (const other of [
    { ...individual, status: "CANCELLED" },
    { ...individual, archivedAt: new Date() as any },
    { ...individual, cohortId: "another-cohort" },
    { ...individual, participants: individual.participants.map((participant) => ({ ...participant, status: "CANCELLED" })) }
  ]) {
    const { client } = readOnlyClient([other]);
    const plan = await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", registrationId: "bundle" }, client);
    assert.deepEqual(plan.emailsToRemove, [joanne, angela]);
    assert.deepEqual(plan.emailsKeptForActiveEnrollment, []);
  }
});

test("a one-seat active POC with no saved roster protects attendance, but an administrative group POC does not", async () => {
  const emptyRoster = { ...individual, participants: [] };
  const active = readOnlyClient([emptyRoster]);
  assert.deepEqual((await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", registrationId: "bundle" }, active.client)).emailsKeptForActiveEnrollment, [joanne]);
  const adminOnly = readOnlyClient([{ ...emptyRoster, participantCount: 2 }]);
  assert.deepEqual((await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", registrationId: "bundle" }, adminOnly.client)).emailsKeptForActiveEnrollment, []);
});

test("participant removal and email changes exclude the affected participant without removing another active copy", async () => {
  const { client, queries } = readOnlyClient();
  const plan = await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", participantIds: ["bundle-joanne"], emails: [" J.MCCANN@sau33.com "] }, client);
  assert.deepEqual(plan.emailsToRemove, []);
  assert.deepEqual(plan.emailsKeptForActiveEnrollment, [joanne]);
  assert.deepEqual(queries[0].select.participants.where.id, { notIn: ["bundle-joanne"] });
  const only = readOnlyClient([]);
  assert.deepEqual((await planFutureGoogleCalendarAttendeeRemoval({ cohortId: "km", participantIds: ["bundle-joanne"] }, only.client)).emailsToRemove, [joanne]);
});

test("a registration from another cohort cannot be used to remove calendar attendees", async () => {
  const { client } = readOnlyClient();
  await assert.rejects(planFutureGoogleCalendarAttendeeRemoval({ cohortId: "another-cohort", registrationId: "bundle" }, client), /does not belong/);
});

test("when all affected people remain enrolled, cleanup does not read or mutate Google events", async () => {
  const { client } = readOnlyClient([{ ...individual, participants: [...individual.participants, { id: "individual-angela", firstName: "Angela", lastName: "Parsons", email: angela, status: "REGISTERED" }] }]);
  // This read-only client has no Google or mutation dependencies. If cleanup
  // proceeds beyond the protected enrollment check, this test fails.
  const result = await removeFutureGoogleCalendarAttendees({ cohortId: "km", registrationId: "bundle" }, client);
  assert.equal(result.sessionsUpdated, 0);
  assert.deepEqual(result.emailsKeptForActiveEnrollment, [joanne, angela]);
});

test("the cancellation preview distinguishes removed and retained people and scopes the unpaid invoice", async () => {
  const { client } = readOnlyClient();
  const preview = await previewRegistrationCancellation("bundle", client);
  assert.deepEqual(preview.effects.calendarEmails, [angela]);
  assert.deepEqual(preview.effects.calendarEmailsPreserved, [joanne]);
  assert.deepEqual(preview.effects.communicationsToCancel.map((message) => message.id), ["bundle-reminder"]);
  assert.match(preview.email.bodyText, /Your separate active enrollment.*remains in place/);
  assert.match(preview.email.bodyText, /Participants remaining enrolled\n\n- Joanne McCann/);
  assert.match(preview.email.bodyText, /Participants leaving this cohort\n\n- Angela Parsons/);
  assert.match(preview.email.bodyText, /KM-2026-454 has been voided/);
  assert.doesNotMatch(preview.email.bodyText, /refund|Participants removed|\{\{/i);
  assert.equal(preview.invoice.disposition, "void_and_attach");
});

test("a preview with no calendar removals shows zero affected sessions", async () => {
  const { client } = readOnlyClient([{ ...individual, participants: [...individual.participants, { id: "other-angela", firstName: "Angela", lastName: "Parsons", email: angela, status: "REGISTERED" }] }]);
  const preview = await previewRegistrationCancellation("bundle", client);
  assert.deepEqual(preview.effects.futureCalendarSessions, []);
  assert.deepEqual(preview.effects.calendarEmails, []);
  assert.doesNotMatch(preview.email.bodyText, /Participants leaving this cohort/);
});

test("cancelling messages remains scoped to the cancelled registration, never to the shared email", async () => {
  let input: any;
  const client = { cohortCommunication: { updateMany: async (args: any) => { input = args; return { count: 1 }; } } } as unknown as NonNullable<Parameters<typeof cancelRegistrationJourneys>[2]>;
  await cancelRegistrationJourneys("bundle", "Duplicate registration cancelled.", client);
  assert.equal(input.where.registrationId, "bundle");
  assert.equal(input.where.recipientEmails, undefined);
  assert.equal(input.data.status, "CANCELLED");
});

test("attendance wording escapes roster names and does not tell an administrative POC they are enrolled", () => {
  const details = registrationCancellationAttendanceMessage({
    participants: [{ name: '<script>alert("x")</script>', email: joanne }],
    requestedEmails: [joanne], emailsKeptForActiveEnrollment: [joanne], primaryContactEmail: "admin@example.com"
  });
  assert.match(details.html, /&lt;script&gt;/);
  assert.doesNotMatch(details.html, /<script>|Your separate active enrollment/);
  assert.match(details.text, /following participants remain enrolled/);
});
