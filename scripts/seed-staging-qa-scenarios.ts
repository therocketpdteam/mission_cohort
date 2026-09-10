import {
  CohortStatus,
  CohortType,
  InvoiceDraftStatus,
  OrganizationType,
  ParticipantListStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  RegistrationStatus,
  SupportingDocumentStatus
} from "@prisma/client";

const prisma = new PrismaClient();
const STAGING_PROJECT_REF = "untuqynkgemgvwmnknhg";
const QA_SOURCE = "STAGING_QA_SEED_V1";

type RegistrationSeed = {
  key: string;
  organization: string;
  state: string;
  poc: string;
  size: number;
  paymentStatus: PaymentStatus;
  paidAmount?: number;
  po?: string;
  invoice?: boolean;
};

const scenarios: Array<{
  slug: string;
  shortName: string;
  title: string;
  price: number;
  start: string;
  registrations: RegistrationSeed[];
}> = [
  {
    slug: "qa-large-team-2027",
    shortName: "QA-Large-2027",
    title: "QA Large Team Cohort",
    price: 495,
    start: "2027-02-04T20:30:00.000Z",
    registrations: [
      { key: "large20", organization: "QA North Valley Schools", state: "CA", poc: "Jordan Rivera", size: 20, paymentStatus: PaymentStatus.INVOICED, po: "PO-QA-2048", invoice: true },
      { key: "team8", organization: "QA Desert Learning Network", state: "AZ", poc: "Morgan Lee", size: 8, paymentStatus: PaymentStatus.PARTIALLY_PAID, paidAmount: 1980, invoice: true },
      { key: "solo", organization: "QA Lakeside Academy", state: "FL", poc: "Avery Chen", size: 1, paymentStatus: PaymentStatus.PAID, paidAmount: 495, invoice: true }
    ]
  },
  {
    slug: "qa-mixed-billing-2027",
    shortName: "QA-Billing-2027",
    title: "QA Mixed Billing Cohort",
    price: 795,
    start: "2027-03-09T19:30:00.000Z",
    registrations: [
      { key: "large20", organization: "QA Coastal Public Schools", state: "FL", poc: "Taylor Brooks", size: 20, paymentStatus: PaymentStatus.PAID, paidAmount: 15900, invoice: true },
      { key: "team5", organization: "QA Redwood Charter Group", state: "CA", poc: "Casey Martin", size: 5, paymentStatus: PaymentStatus.INVOICED, invoice: true },
      { key: "solo1", organization: "QA Sonoran Preparatory", state: "AZ", poc: "Riley Patel", size: 1, paymentStatus: PaymentStatus.PENDING },
      { key: "solo2", organization: "QA Harbor School", state: "CA", poc: "Jamie Wilson", size: 1, paymentStatus: PaymentStatus.PAID, paidAmount: 795, invoice: true },
      { key: "solo3", organization: "QA Palm Grove School", state: "FL", poc: "Cameron Diaz", size: 1, paymentStatus: PaymentStatus.INVOICED, invoice: true }
    ]
  },
  {
    slug: "qa-registration-changes-2027",
    shortName: "QA-Changes-2027",
    title: "QA Registration Changes Cohort",
    price: 295,
    start: "2027-04-14T19:30:00.000Z",
    registrations: [
      { key: "large20", organization: "QA Metro Education Collaborative", state: "CA", poc: "Alex Thompson", size: 20, paymentStatus: PaymentStatus.INVOICED, invoice: true },
      { key: "team3", organization: "QA Canyon School District", state: "AZ", poc: "Sam Bennett", size: 3, paymentStatus: PaymentStatus.PAID, paidAmount: 885, invoice: true },
      { key: "solo", organization: "QA Sunshine Leadership School", state: "FL", poc: "Drew Parker", size: 1, paymentStatus: PaymentStatus.PENDING }
    ]
  }
];

function emailFor(slug: string, key: string, role: string, index?: number) {
  return `gerardo+mcqa-${slug.replace(/[^a-z0-9]/g, "-")}-${key}-${role}${index ?? ""}@rocketpd.com`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Refusing to seed: DATABASE_URL is not the ${STAGING_PROJECT_REF} staging project.`);
  }

  const presenter = await prisma.presenter.upsert({
    where: { email: "qa-presenter@rocketpd.com" },
    update: { active: true },
    create: { firstName: "QA", lastName: "Presenter", shortName: "QA", email: "qa-presenter@rocketpd.com", organization: "RocketPD" }
  });

  for (const scenario of scenarios) {
    const startDate = new Date(scenario.start);
    const endDate = new Date(startDate.getTime() + 28 * 24 * 60 * 60 * 1000);
    const cohort = await prisma.cohort.upsert({
      where: { slug: scenario.slug },
      update: {
        title: scenario.title,
        shortName: scenario.shortName,
        status: CohortStatus.DRAFT,
        publicRegistrationEnabled: false,
        pricePerParticipant: scenario.price
      },
      create: {
        title: scenario.title,
        shortName: scenario.shortName,
        slug: scenario.slug,
        description: "Staging-only cohort for testing registration, roster, invoice, communication, and calendar-invite workflows.",
        presenterId: presenter.id,
        status: CohortStatus.DRAFT,
        startDate,
        endDate,
        registrationOpenDate: new Date("2026-09-01T12:00:00.000Z"),
        registrationCloseDate: new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        defaultTimezone: "America/New_York",
        maxParticipants: 100,
        pricePerParticipant: scenario.price,
        cohortType: CohortType.LIVE_VIRTUAL,
        publicRegistrationEnabled: false
      }
    });

    await prisma.cohortSession.deleteMany({ where: { cohortId: cohort.id } });
    await prisma.cohortSession.createMany({
      data: Array.from({ length: 4 }, (_, index) => {
        const sessionStart = new Date(startDate.getTime() + index * 7 * 24 * 60 * 60 * 1000);
        return {
          cohortId: cohort.id,
          title: `${index + 1}. QA Session ${index + 1}`,
          description: "Staging session used to verify reminders and calendar invitation attachments.",
          sessionNumber: index + 1,
          startTime: sessionStart,
          endTime: new Date(sessionStart.getTime() + 2 * 60 * 60 * 1000),
          timezone: "America/New_York",
          meetingUrl: `https://example.com/staging-qa/${scenario.slug}/session-${index + 1}`
        };
      })
    });

    const oldRegistrations = await prisma.registration.findMany({ where: { cohortId: cohort.id, externalSource: QA_SOURCE }, select: { id: true } });
    const oldIds = oldRegistrations.map((item) => item.id);
    if (oldIds.length) {
      await prisma.invoiceDraft.deleteMany({ where: { registrationId: { in: oldIds } } });
      await prisma.paymentRecord.deleteMany({ where: { registrationId: { in: oldIds } } });
      await prisma.participant.deleteMany({ where: { registrationId: { in: oldIds } } });
      await prisma.registration.deleteMany({ where: { id: { in: oldIds } } });
    }

    for (const registrationSeed of scenario.registrations) {
      const organization = await prisma.organization.create({
        data: {
          name: registrationSeed.organization,
          type: registrationSeed.size > 1 ? OrganizationType.DISTRICT : OrganizationType.SCHOOL,
          state: registrationSeed.state,
          notes: "Staging QA test organization"
        }
      });
      const total = registrationSeed.size * scenario.price;
      const [firstName, ...lastParts] = registrationSeed.poc.split(" ");
      const lastName = lastParts.join(" ") || "Contact";
      const pocEmail = emailFor(scenario.slug, registrationSeed.key, "poc");
      const invoiceNumber = registrationSeed.invoice ? `QA-${scenario.shortName}-${registrationSeed.key}`.toUpperCase() : null;
      const registration = await prisma.registration.create({
        data: {
          cohortId: cohort.id,
          organizationId: organization.id,
          primaryContactName: registrationSeed.poc,
          primaryContactEmail: pocEmail,
          primaryContactTitle: "Director of Professional Learning",
          billingContactName: registrationSeed.poc,
          billingContactEmail: pocEmail,
          paymentMethod: registrationSeed.po ? PaymentMethod.PURCHASE_ORDER : PaymentMethod.INVOICE,
          paymentStatus: registrationSeed.paymentStatus,
          invoiceNumber,
          purchaseOrderNumber: registrationSeed.po,
          participantListStatus: ParticipantListStatus.COMPLETE,
          supportingDocumentStatus: registrationSeed.invoice ? SupportingDocumentStatus.READY : SupportingDocumentStatus.NOT_READY,
          totalAmount: total,
          participantCount: registrationSeed.size,
          status: RegistrationStatus.CONFIRMED,
          source: "Staging QA",
          externalSource: QA_SOURCE,
          externalSubmissionId: `${scenario.slug}:${registrationSeed.key}`,
          notes: "Safe staging test record. All outbound email must be captured to the configured QA mailbox."
        }
      });

      await prisma.participant.createMany({
        data: Array.from({ length: registrationSeed.size }, (_, index) => ({
          registrationId: registration.id,
          cohortId: cohort.id,
          organizationId: organization.id,
          firstName: index === 0 ? firstName : `Participant ${index + 1}`,
          lastName: index === 0 ? lastName : registrationSeed.organization.split(" ")[1] ?? "QA",
          email: index === 0 ? pocEmail : emailFor(scenario.slug, registrationSeed.key, "participant", index + 1),
          title: index === 0 ? "Director of Professional Learning" : "School Leader"
        }))
      });

      if (registrationSeed.invoice) {
        await prisma.invoiceDraft.create({
          data: {
            cohortId: cohort.id,
            registrationId: registration.id,
            organizationId: organization.id,
            invoiceNumber,
            purchaseOrderNumber: registrationSeed.po,
            status: InvoiceDraftStatus.DRAFT,
            subtotalAmount: total,
            totalAmount: total,
            paidAmount: registrationSeed.paidAmount ?? 0,
            notes: "Staging QA invoice; generated without external side effects.",
            lineItems: {
              create: {
                description: scenario.title,
                quantity: registrationSeed.size,
                unitAmount: scenario.price,
                totalAmount: total
              }
            }
          }
        });
      }

      if ((registrationSeed.paidAmount ?? 0) > 0) {
        await prisma.paymentRecord.create({
          data: {
            registrationId: registration.id,
            cohortId: cohort.id,
            organizationId: organization.id,
            amount: registrationSeed.paidAmount!,
            status: registrationSeed.paymentStatus,
            method: PaymentMethod.INVOICE,
            invoiceNumber,
            paymentDate: new Date("2026-09-08T12:00:00.000Z"),
            notes: "Staging QA payment record"
          }
        });
      }
    }
  }

  const result = await prisma.cohort.findMany({
    where: { slug: { in: scenarios.map((item) => item.slug) } },
    select: { shortName: true, status: true, _count: { select: { registrations: true, participants: true, sessions: true } } },
    orderBy: { shortName: "asc" }
  });
  console.table(result.map((item) => ({ cohort: item.shortName, status: item.status, ...item._count })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
