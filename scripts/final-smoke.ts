import {
  CohortType,
  OrganizationType,
  PaymentMethod,
  PaymentStatus,
  Role
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { createCalendarInvitePlaceholder } from "../src/services/calendarService";
import { createCohort } from "../src/services/cohortService";
import { createPlannedSessionReminders } from "../src/services/communicationService";
import { renderTemplate, validateMergeFields } from "../src/services/emailService";
import { createOrganization } from "../src/services/organizationService";
import { addParticipant } from "../src/services/participantService";
import { createPaymentRecord, updatePaymentStatus } from "../src/services/paymentService";
import { createPresenter } from "../src/services/presenterService";
import { confirmRegistration, createRegistration } from "../src/services/registrationService";
import { createSession } from "../src/services/sessionService";
import { processRegistrationWebhook } from "../src/services/webhookService";

async function main() {
  const stamp = Date.now();

  await prisma.$queryRaw`SELECT 1`;
  console.log("health/database: ok");

  const admin = await prisma.user.upsert({
    where: { email: "qa.admin@missioncontrol.local" },
    update: {},
    create: {
      email: "qa.admin@missioncontrol.local",
      firstName: "QA",
      lastName: "Admin",
      role: Role.SUPER_ADMIN
    }
  });

  const presenter = await createPresenter({
    firstName: "QA",
    lastName: `Presenter ${stamp}`,
    email: `qa.presenter.${stamp}@example.com`
  });

  const organization = await createOrganization({
    name: `QA District ${stamp}`,
    type: OrganizationType.DISTRICT,
    city: "Austin",
    state: "TX"
  });

  const cohort = await createCohort({
    title: `QA Cohort ${stamp}`,
    slug: `qa-cohort-${stamp}`,
    presenterId: presenter.id,
    startDate: new Date("2026-10-01T14:00:00.000Z"),
    endDate: new Date("2026-10-29T15:00:00.000Z"),
    registrationOpenDate: new Date("2026-08-01T14:00:00.000Z"),
    registrationCloseDate: new Date("2026-09-25T14:00:00.000Z"),
    pricePerParticipant: 125,
    cohortType: CohortType.LIVE_VIRTUAL,
    defaultTimezone: "America/New_York",
    publicRegistrationEnabled: false
  });
  console.log("create cohort: ok");

  const session = await createSession({
    cohortId: cohort.id,
    title: "QA Session",
    description: "QA session description with meeting URL.",
    sessionNumber: 1,
    startTime: new Date("2026-10-01T14:00:00.000Z"),
    endTime: new Date("2026-10-01T15:00:00.000Z"),
    timezone: "America/New_York",
    meetingUrl: "https://example.com/qa-session"
  });
  console.log("create session: ok");

  const registration = await createRegistration({
    cohortId: cohort.id,
    organizationId: organization.id,
    primaryContactName: "QA Contact",
    primaryContactEmail: `qa.contact.${stamp}@example.com`,
    paymentMethod: PaymentMethod.INVOICE,
    paymentStatus: PaymentStatus.PENDING,
    totalAmount: 125,
    participantCount: 1
  });
  await confirmRegistration(registration.id);
  console.log("create/confirm registration: ok");

  await addParticipant({
    registrationId: registration.id,
    cohortId: cohort.id,
    organizationId: organization.id,
    firstName: "QA",
    lastName: "Participant",
    email: `qa.participant.${stamp}@example.com`
  });
  console.log("add participant: ok");

  const payment = await createPaymentRecord({
    registrationId: registration.id,
    cohortId: cohort.id,
    organizationId: organization.id,
    amount: 125,
    method: PaymentMethod.INVOICE,
    status: PaymentStatus.PENDING
  });
  await updatePaymentStatus(payment.id, { status: PaymentStatus.PAID, paymentDate: new Date() });
  console.log("update payment status: ok");

  const rendered = renderTemplate("Hello {{participant.firstName}} from {{organization.name}}", {
    participant: { firstName: "QA" },
    organization: { name: organization.name }
  });
  if (rendered.output !== `Hello QA from ${organization.name}`) {
    throw new Error("Merge field render failed");
  }
  const warnings = validateMergeFields("Unknown {{bad.field}}");
  if (warnings.length === 0) {
    throw new Error("Unknown merge field warning failed");
  }
  console.log("merge fields render/warn: ok");

  const reminders = await createPlannedSessionReminders(session.id, admin.id);
  if (reminders.length !== 3) {
    throw new Error("Reminder schedule generation failed");
  }
  console.log("session reminders: ok");

  const calendar = await createCalendarInvitePlaceholder(session.id, "ics");
  if (!("ics" in calendar) || !calendar.ics.includes("QA Session") || !calendar.ics.includes("https://example.com/qa-session")) {
    throw new Error("ICS generation failed");
  }
  console.log("ICS generation: ok");

  const webhookResult = await processRegistrationWebhook({
    source: "qa_smoke",
    eventType: "registration.submitted",
    organization: {
      id: `qa-webhook-org-${stamp}`,
      name: `QA Webhook Org ${stamp}`,
      type: "DISTRICT"
    },
    registration: {
      cohortId: cohort.id,
      primaryContactName: "QA Webhook Contact",
      primaryContactEmail: `qa.webhook.${stamp}@example.com`,
      paymentMethod: "INVOICE",
      paymentStatus: "PENDING",
      totalAmount: 250,
      participantCount: 2
    },
    participants: [
      {
        firstName: "Webhook",
        lastName: "One",
        email: `webhook.one.${stamp}@example.com`
      },
      {
        firstName: "Webhook",
        lastName: "Two",
        email: `webhook.two.${stamp}@example.com`
      }
    ],
    payment: {
      amount: 250,
      method: "INVOICE",
      status: "PENDING",
      invoiceNumber: `QA-WEBHOOK-${stamp}`
    }
  });

  if (webhookResult.participants.length !== 2 || !webhookResult.payment) {
    throw new Error("Webhook processing failed");
  }
  console.log("registration webhook processing: ok");

  const auditCount = await prisma.auditLog.count({
    where: { entityId: cohort.id }
  });
  console.log(`audit log check: ok (${auditCount} cohort events)`);

  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  try {
    const response = await fetch(`${appBaseUrl}/api/health`);
    console.log(`HTTP health endpoint: ${response.ok ? "ok" : `failed (${response.status})`}`);
  } catch {
    console.log("HTTP health endpoint: skipped (start dev server to test HTTP routes)");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
