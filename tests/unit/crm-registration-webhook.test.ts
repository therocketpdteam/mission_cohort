import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceStatus, ParticipantStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import {
  buildCrmRegistrationWebhookPayload,
  buildCrmRegistrationWebhookPayloads,
  calculateCohortTotals,
  crmFriendlyCohortShortName,
  crmRegistrationWebhookHeaders,
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
    participantCount: 1,
    totalAmount: 795,
    paymentStatus: PaymentStatus.PENDING,
    notes: null,
    status: RegistrationStatus.CONFIRMED,
    createdAt: new Date("2026-07-10T15:00:00.000Z"),
    updatedAt: new Date("2026-07-10T15:30:00.000Z"),
    archivedAt: null,
    cohort: {
      id: "cohort-456",
      title: "Building Thinking Classrooms",
      shortName: null,
      startDate: new Date("2026-07-28T00:00:00.000Z"),
      endDate: new Date("2026-08-30T00:00:00.000Z"),
      presenter: {
        id: "presenter-789",
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
    paymentRecords: [],
    invoiceDrafts: [],
    ...overrides
  };
}

test("builds the CRM registration webhook payload with cohort, participant, account, status, and dates", () => {
  const payload = buildCrmRegistrationWebhookPayload(registration());

  assert.deepEqual(payload, {
    organizationSlug: "rocketpd",
    missionCohortId: "cohort-456",
    missionRegistrationId: "registration-123",
    missionParticipantId: "registration-123",
    cohortName: "Building Thinking Classrooms",
    shortName: "PL Summer 2026",
    startsAt: "2026-07-28T00:00:00.000Z",
    endsAt: "2026-08-30T00:00:00.000Z",
    productId: null,
    productName: "Building Thinking Classrooms",
    thoughtLeaderId: "presenter-789",
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
    paidOrganizationName: "West Ada School District",
    paidOrganizationDomain: "westada.org",
    status: "registered",
    registrationPaymentStatus: PaymentStatus.PENDING,
    registrationNotes: null,
    registeredAt: "2026-07-10T15:00:00.000Z",
    occurredAt: "2026-07-10T15:30:00.000Z",
    seatValue: 795,
    collectedValue: 0,
    registrationTotalValue: 795,
    registrationCollectedValue: 0,
    totalCohortValue: 795,
    collectedCohortValue: 0,
    activeRegistrantCount: 1,
    withdrawnCount: 0
  });
});

test("builds one CRM payload per saved participant with cohort totals", () => {
  const row = registration({
    participantCount: 2,
    totalAmount: 1590,
    participants: [
      {
        id: "participant-1",
        firstName: "Brent",
        lastName: "Jons",
        email: "brent.jons@westada.org",
        title: "Director",
        phone: null,
        status: ParticipantStatus.REGISTERED,
        attendanceStatus: AttendanceStatus.UNKNOWN
      },
      {
        id: "participant-2",
        firstName: "Alex",
        lastName: "Rivera",
        email: "alex.rivera@westada.org",
        title: "Teacher",
        phone: null,
        status: ParticipantStatus.REGISTERED,
        attendanceStatus: AttendanceStatus.UNKNOWN
      }
    ]
  });
  const payloads = buildCrmRegistrationWebhookPayloads(row);

  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads.map((payload) => payload.missionParticipantId), ["participant-1", "participant-2"]);
  assert.equal(payloads[0]?.seatValue, 795);
  assert.equal(payloads[0]?.collectedValue, 0);
  assert.equal(payloads[0]?.totalCohortValue, 1590);
  assert.equal(payloads[0]?.collectedCohortValue, 0);
  assert.equal(payloads[0]?.activeRegistrantCount, 2);
});

test("calculates active value, collected value, active count, and withdrawn count for cohort totals", () => {
  const totals = calculateCohortTotals([
    registration({
      participantCount: 2,
      totalAmount: 1590,
      paymentRecords: [{ amount: 795, status: PaymentStatus.PARTIALLY_PAID }]
    }),
    registration({ participantCount: 1, totalAmount: 795, paymentStatus: PaymentStatus.PAID }),
    registration({ participantCount: 1, totalAmount: 795, status: RegistrationStatus.CANCELLED })
  ]);

  assert.deepEqual(totals, {
    totalCohortValue: 2385,
    collectedCohortValue: 1590,
    activeRegistrantCount: 3,
    withdrawnCount: 1
  });
});

test("sends collected cohort and per-seat collected values in CRM payloads", () => {
  const row = registration({
    participantCount: 2,
    totalAmount: 1590,
    paymentRecords: [{ amount: 795, status: PaymentStatus.PARTIALLY_PAID }],
    participants: [
      {
        id: "participant-1",
        firstName: "Brent",
        lastName: "Jons",
        email: "brent.jons@westada.org",
        title: "Director",
        phone: null,
        status: ParticipantStatus.REGISTERED,
        attendanceStatus: AttendanceStatus.UNKNOWN
      },
      {
        id: "participant-2",
        firstName: "Alex",
        lastName: "Rivera",
        email: "alex.rivera@westada.org",
        title: "Teacher",
        phone: null,
        status: ParticipantStatus.REGISTERED,
        attendanceStatus: AttendanceStatus.UNKNOWN
      }
    ]
  });
  const totals = calculateCohortTotals([row]);
  const payloads = buildCrmRegistrationWebhookPayloads(row, totals);

  assert.equal(totals.totalCohortValue, 1590);
  assert.equal(totals.collectedCohortValue, 795);
  assert.equal(payloads[0]?.collectedCohortValue, 795);
  assert.equal(payloads[0]?.collectedValue, 397.5);
  assert.equal(Math.round((payloads[0]!.collectedCohortValue / payloads[0]!.totalCohortValue) * 100), 50);
});

test("uses invoice paid amounts when payment records are not available", () => {
  const row = registration({
    participantCount: 1,
    totalAmount: 795,
    invoiceDrafts: [{ paidAmount: 795, status: "PAID" }]
  });
  const payload = buildCrmRegistrationWebhookPayload(row);

  assert.equal(payload.collectedValue, 795);
  assert.equal(payload.registrationCollectedValue, 795);
  assert.equal(payload.collectedCohortValue, 795);
});

test("uses the saved cohort short name before generating a fallback", () => {
  assert.equal(crmFriendlyCohortShortName(registration({ cohort: { ...registration().cohort, shortName: "BTC Summer 2026" } }).cohort), "BTC Summer 2026");
});

test("maps registration and participant status changes to CRM membership statuses", () => {
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.CONFIRMED, archivedAt: null }), "registered");
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.CANCELLED, archivedAt: null }), "cancelled");
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.COMPLETED, archivedAt: null }), "completed");
  assert.equal(mapRegistrationToCrmStatus({ status: RegistrationStatus.CONFIRMED, archivedAt: new Date("2026-07-12T18:00:00.000Z") }), "withdrawn");
  assert.equal(
    mapRegistrationToCrmStatus(
      { status: RegistrationStatus.CONFIRMED, archivedAt: null },
      { status: ParticipantStatus.REGISTERED, attendanceStatus: AttendanceStatus.ABSENT }
    ),
    "no_show"
  );
  assert.equal(
    mapRegistrationToCrmStatus(
      { status: RegistrationStatus.CONFIRMED, archivedAt: null },
      { status: ParticipantStatus.REGISTERED, attendanceStatus: AttendanceStatus.ATTENDED }
    ),
    "attended"
  );
});

test("adds the Vercel protection bypass header only when configured", () => {
  assert.deepEqual(crmRegistrationWebhookHeaders("crm-secret"), {
    Authorization: "Bearer crm-secret",
    "Content-Type": "application/json"
  });

  assert.deepEqual(crmRegistrationWebhookHeaders("crm-secret", "vercel-bypass"), {
    Authorization: "Bearer crm-secret",
    "Content-Type": "application/json",
    "x-vercel-protection-bypass": "vercel-bypass"
  });
});
