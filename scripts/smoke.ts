import { CohortType, OrganizationType, PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { createCohort, listCohorts } from "../src/services/cohortService";
import { createOrganization } from "../src/services/organizationService";
import { addParticipant } from "../src/services/participantService";
import { createPaymentRecord, updatePaymentStatus } from "../src/services/paymentService";
import { createPresenter } from "../src/services/presenterService";
import { createRegistrationForm } from "../src/services/registrationFormService";
import { createRegistration } from "../src/services/registrationService";
import { createSession } from "../src/services/sessionService";

async function main() {
  const stamp = Date.now();

  await prisma.$queryRaw`SELECT 1`;
  console.log("database connection: ok");

  const presenter = await createPresenter({
    firstName: "Smoke",
    lastName: `Presenter ${stamp}`,
    email: `smoke.presenter.${stamp}@example.com`
  });

  const organization = await createOrganization({
    name: `SMOKE Demo District ${stamp}`,
    type: OrganizationType.DISTRICT
  });

  const cohort = await createCohort({
    title: `SMOKE Cohort ${stamp}`,
    slug: `smoke-cohort-${stamp}`,
    presenterId: presenter.id,
    startDate: new Date("2026-09-01T14:00:00.000Z"),
    endDate: new Date("2026-09-29T15:00:00.000Z"),
    pricePerParticipant: 100,
    cohortType: CohortType.LIVE_VIRTUAL,
    defaultTimezone: "America/New_York",
    publicRegistrationEnabled: false
  });
  console.log("create cohort: ok");

  await createSession({
    cohortId: cohort.id,
    title: "SMOKE Session",
    sessionNumber: 1,
    startTime: new Date("2026-09-01T14:00:00.000Z"),
    endTime: new Date("2026-09-01T15:00:00.000Z"),
    timezone: "America/New_York"
  });
  console.log("create session: ok");

  const form = await createRegistrationForm({
    cohortId: cohort.id,
    title: "SMOKE Registration Form",
    slug: `smoke-registration-form-${stamp}`,
    formConfigJson: { fields: [] }
  });
  console.log("create registration form: ok");

  const registration = await createRegistration({
    cohortId: cohort.id,
    organizationId: organization.id,
    formId: form.id,
    primaryContactName: "Smoke Contact",
    primaryContactEmail: `smoke.contact.${stamp}@example.com`,
    paymentMethod: PaymentMethod.INVOICE,
    paymentStatus: PaymentStatus.PENDING,
    totalAmount: 100,
    participantCount: 1
  });
  console.log("create registration: ok");

  await addParticipant({
    registrationId: registration.id,
    cohortId: cohort.id,
    organizationId: organization.id,
    firstName: "Smoke",
    lastName: "Participant",
    email: `smoke.participant.${stamp}@example.com`
  });
  console.log("add participant: ok");

  const payment = await createPaymentRecord({
    registrationId: registration.id,
    cohortId: cohort.id,
    organizationId: organization.id,
    amount: 100,
    method: PaymentMethod.INVOICE,
    status: PaymentStatus.PENDING
  });

  await updatePaymentStatus(payment.id, { status: PaymentStatus.PAID, paymentDate: new Date() });
  console.log("update payment status: ok");

  const cohorts = await listCohorts();
  console.log(`list cohorts: ok (${cohorts.length})`);

  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  try {
    const response = await fetch(`${appBaseUrl}/api/health`);
    console.log(`health endpoint: ${response.ok ? "ok" : `failed (${response.status})`}`);
  } catch {
    console.log("health endpoint: skipped (start dev server to test HTTP health)");
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
