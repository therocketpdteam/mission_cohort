import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceStatus, ParticipantStatus, RegistrationStatus } from "@prisma/client";
import {
  buildCrmRegistrationWebhookPayload,
  crmFriendlyCohortShortName,
  mapRegistrationToCrmStatus,
  type CrmRegistrationRecord
} from "../../src/services/crmRegistrationWebhookService";

function registration(overrides: Partial<CrmRegistrationRecord> = {}): CrmRegistrationRecord {
  return {
    id: "registration-123",
    primaryContactName: "Brent Jons",
    primaryContactEmail: "BRENT.JONS@WESTADA.ORG",
    primaryContactPhone: "208-555-1212",
    primaryContactTitle: "Teacher",
    status: RegistrationStatus.CONFIRMED,
    createdAt: new Date("2026-07-10T15:00:00.000Z"),
    archivedAt: null,
    cohort: {
      id: "cohort-456",
      title: "Building Thinking Classrooms",
      shortName: null,
      startDate: new Date("2026-07-28T00:00:00.000Z"),
      endDate: new Date("2026-08-30T00:00:00.000Z"),
      presenter: {
        firstName: "Peter",
        lastName: "Liljedahl",
        shortName: "PL"
      }
    },
    organization: {
      name: "West Ada School District",
      website: "https://www.westada.org"
    },
    participants: [],
    ...overrides
  };
}

test("builds the CRM registration webhook payload with cohort, participant, account, status, and dates", () => {
  const payload = buildCrmRegistrationWebhookPayload(registration());

  assert.deepEqual(payload, {
    missionCohortId: "cohort-456",
    missionParticipantId: "registration-123",
    shortName: "PL Summer 2026",
    cohortName: "Building Thinking Classrooms",
    startsAt: "2026-07-28T00:00:00.000Z",
    endsAt: "2026-08-30T00:00:00.000Z",
    productName: "Cohorts",
    thoughtLeaderName: "Peter Liljedahl",
    participant: {
      email: "brent.jons@westada.org",
      firstName: "Brent",
      lastName: "Jons",
      fullName: "Brent Jons",
      title: "Teacher",
      phone: "208-555-1212"
    },
    accountName: "West Ada School District",
    accountDomain: "westada.org",
    status: "registered",
    registeredAt: "2026-07-10T15:00:00.000Z"
  });
});

test("uses the saved cohort short name before generating a fallback", () => {
  assert.equal(crmFriendlyCohortShortName(registration({ cohort: { ...registration().cohort, shortName: "BTC Summer 2026" } }).cohort), "BTC Summer 2026");
});

test("maps registration and participant status changes to CRM membership statuses", () => {
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.CONFIRMED, archivedAt: null }), "registered");
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.CANCELLED, archivedAt: null }), "cancelled");
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.COMPLETED, archivedAt: null }), "completed");
  assert.equal(
    mapRegistrationToCrmStatus(
      { status: RegistrationStatus.CONFIRMED, archivedAt: null },
      { status: ParticipantStatus.REGISTERED, attendanceStatus: AttendanceStatus.ATTENDED }
    ),
    "attended"
  );
});
