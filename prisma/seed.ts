import {
  CohortStatus,
  CohortType,
  CommunicationStatus,
  OrganizationType,
  OperationsTaskCategory,
  OperationsTaskPriority,
  ParticipantListStatus,
  PaymentMethod,
  PaymentStatus,
  RecipientScope,
  RegistrationStatus,
  Role,
  SupportingDocumentStatus,
  TemplateType
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin.demo@missioncontrol.local" },
    update: {},
    create: {
      email: "admin.demo@missioncontrol.local",
      firstName: "Demo",
      lastName: "Admin",
      role: Role.SUPER_ADMIN
    }
  });

  const northview = await prisma.organization.upsert({
    where: { id: "demo-org-northview" },
    update: {},
    create: {
      id: "demo-org-northview",
      name: "DEMO Northview School District",
      type: OrganizationType.DISTRICT,
      city: "Raleigh",
      state: "NC",
      notes: "Demo seed district"
    }
  });

  const cedar = await prisma.organization.upsert({
    where: { id: "demo-org-cedar" },
    update: {},
    create: {
      id: "demo-org-cedar",
      name: "DEMO Cedar County Schools",
      type: OrganizationType.DISTRICT,
      city: "Columbus",
      state: "OH",
      notes: "Demo seed district"
    }
  });

  const presenterA = await prisma.presenter.upsert({
    where: { email: "maya.rivera.demo@missioncontrol.local" },
    update: {},
    create: {
      firstName: "Maya",
      lastName: "Rivera",
      email: "maya.rivera.demo@missioncontrol.local",
      organization: "DEMO Learning Labs",
      bio: "Demo presenter for cohort operations testing."
    }
  });

  const presenterB = await prisma.presenter.upsert({
    where: { email: "jon.ellis.demo@missioncontrol.local" },
    update: {},
    create: {
      firstName: "Jon",
      lastName: "Ellis",
      email: "jon.ellis.demo@missioncontrol.local",
      organization: "DEMO Strategy Group",
      bio: "Demo thought leader for seed data."
    }
  });

  const cohortA = await prisma.cohort.upsert({
    where: { slug: "demo-instructional-leadership-spring" },
    update: {},
    create: {
      title: "DEMO Instructional Leadership Spring Cohort",
      slug: "demo-instructional-leadership-spring",
      description: "Demo cohort for admin operations workflows.",
      presenterId: presenterA.id,
      status: CohortStatus.REGISTRATION_OPEN,
      startDate: new Date("2026-05-12T14:00:00.000Z"),
      endDate: new Date("2026-06-16T15:30:00.000Z"),
      registrationOpenDate: new Date("2026-04-01T12:00:00.000Z"),
      registrationCloseDate: new Date("2026-05-05T12:00:00.000Z"),
      maxParticipants: 40,
      minParticipants: 10,
      pricePerParticipant: 595,
      cohortType: CohortType.LIVE_VIRTUAL,
      publicRegistrationEnabled: true
    }
  });

  const cohortB = await prisma.cohort.upsert({
    where: { slug: "demo-ai-operations-summer" },
    update: {},
    create: {
      title: "DEMO AI Operations Summer Cohort",
      slug: "demo-ai-operations-summer",
      description: "Demo cohort for payment and communications testing.",
      presenterId: presenterB.id,
      status: CohortStatus.PUBLISHED,
      startDate: new Date("2026-07-08T16:00:00.000Z"),
      endDate: new Date("2026-08-05T17:30:00.000Z"),
      registrationOpenDate: new Date("2026-05-15T12:00:00.000Z"),
      registrationCloseDate: new Date("2026-06-30T12:00:00.000Z"),
      maxParticipants: 30,
      minParticipants: 8,
      pricePerParticipant: 795,
      cohortType: CohortType.HYBRID,
      publicRegistrationEnabled: true
    }
  });

  const sessionA1 = await prisma.cohortSession.upsert({
    where: { cohortId_sessionNumber: { cohortId: cohortA.id, sessionNumber: 1 } },
    update: {},
    create: {
      cohortId: cohortA.id,
      title: "DEMO Leadership Foundations",
      sessionNumber: 1,
      startTime: new Date("2026-05-12T14:00:00.000Z"),
      endTime: new Date("2026-05-12T15:30:00.000Z"),
      timezone: "America/New_York",
      meetingUrl: "https://example.com/demo-session-1"
    }
  });

  await prisma.cohortSession.upsert({
    where: { cohortId_sessionNumber: { cohortId: cohortA.id, sessionNumber: 2 } },
    update: {},
    create: {
      cohortId: cohortA.id,
      title: "DEMO Coaching Cadence",
      sessionNumber: 2,
      startTime: new Date("2026-05-26T14:00:00.000Z"),
      endTime: new Date("2026-05-26T15:30:00.000Z"),
      timezone: "America/New_York",
      meetingUrl: "https://example.com/demo-session-2"
    }
  });

  await prisma.cohortSession.upsert({
    where: { cohortId_sessionNumber: { cohortId: cohortB.id, sessionNumber: 1 } },
    update: {},
    create: {
      cohortId: cohortB.id,
      title: "DEMO AI Workflow Mapping",
      sessionNumber: 1,
      startTime: new Date("2026-07-08T16:00:00.000Z"),
      endTime: new Date("2026-07-08T17:30:00.000Z"),
      timezone: "America/New_York",
      location: "DEMO Training Center"
    }
  });

  const formA = await prisma.registrationForm.upsert({
    where: { slug: "demo-instructional-leadership-registration" },
    update: {},
    create: {
      cohortId: cohortA.id,
      title: "DEMO Instructional Leadership Registration",
      slug: "demo-instructional-leadership-registration",
      formConfigJson: {
        demo: true,
        fields: ["primaryContact", "billingContact", "participants"]
      },
      successMessage: "Demo registration received.",
      webhookEnabled: true
    }
  });

  await prisma.registrationForm.upsert({
    where: { slug: "demo-ai-operations-registration" },
    update: {},
    create: {
      cohortId: cohortB.id,
      title: "DEMO AI Operations Registration",
      slug: "demo-ai-operations-registration",
      formConfigJson: {
        demo: true,
        fields: ["primaryContact", "purchaseOrder", "participants"]
      },
      successMessage: "Demo registration received.",
      webhookEnabled: true
    }
  });

  const registration = await prisma.registration.upsert({
    where: { id: "demo-registration-northview-leadership" },
    update: {},
    create: {
      id: "demo-registration-northview-leadership",
      cohortId: cohortA.id,
      organizationId: northview.id,
      formId: formA.id,
      primaryContactName: "DEMO Avery Brooks",
      primaryContactEmail: "avery.brooks.demo@example.com",
      primaryContactPhone: "555-0101",
      primaryContactTitle: "Assistant Superintendent",
      billingContactName: "DEMO Morgan Lee",
      billingContactEmail: "morgan.lee.demo@example.com",
      billingAddress: "100 Demo Way, Raleigh, NC",
      paymentMethod: PaymentMethod.INVOICE,
      paymentStatus: PaymentStatus.INVOICED,
      invoiceNumber: "DEMO-INV-1001",
      participantListStatus: ParticipantListStatus.COMPLETE,
      supportingDocumentStatus: SupportingDocumentStatus.READY,
      w9Url: "https://example.com/demo-w9.pdf",
      invoiceUrl: "https://example.com/demo-invoice.pdf",
      quickBooksCustomerRef: "DEMO-QB-CUST-1001",
      quickBooksInvoiceRef: "DEMO-QB-INV-1001",
      totalAmount: 1190,
      participantCount: 2,
      status: RegistrationStatus.CONFIRMED,
      source: "demo_seed",
      notes: "Demo registration"
    }
  });

  await prisma.participant.createMany({
    data: [
      {
        id: "demo-participant-jordan-kim",
        registrationId: registration.id,
        cohortId: cohortA.id,
        organizationId: northview.id,
        firstName: "DEMO Jordan",
        lastName: "Kim",
        email: "jordan.kim.demo@example.com",
        title: "Principal"
      },
      {
        id: "demo-participant-taylor-nguyen",
        registrationId: registration.id,
        cohortId: cohortA.id,
        organizationId: northview.id,
        firstName: "DEMO Taylor",
        lastName: "Nguyen",
        email: "taylor.nguyen.demo@example.com",
        title: "Instructional Coach"
      }
    ],
    skipDuplicates: true
  });

  await prisma.paymentRecord.upsert({
    where: { id: "demo-payment-northview-invoice" },
    update: {},
    create: {
      id: "demo-payment-northview-invoice",
      registrationId: registration.id,
      cohortId: cohortA.id,
      organizationId: northview.id,
      amount: 1190,
      status: PaymentStatus.INVOICED,
      method: PaymentMethod.INVOICE,
      invoiceNumber: "DEMO-INV-1001",
      quickBooksPaymentRef: "DEMO-QB-PAY-1001",
      notes: "Demo invoice payment record"
    }
  });

  await prisma.operationsTask.createMany({
    data: [
      {
        id: "demo-task-calendar-session-1",
        cohortId: cohortA.id,
        sessionId: sessionA1.id,
        title: "DEMO Confirm calendar invites",
        description: "Demo checklist item replacing external project-board tracking.",
        category: OperationsTaskCategory.CALENDAR_INVITE,
        priority: OperationsTaskPriority.HIGH
      },
      {
        id: "demo-task-payment-follow-up",
        cohortId: cohortA.id,
        registrationId: registration.id,
        title: "DEMO Review invoice status",
        description: "Demo payment follow-up task for internal operations tracking.",
        category: OperationsTaskCategory.PAYMENT_FOLLOW_UP,
        priority: OperationsTaskPriority.MEDIUM
      }
    ],
    skipDuplicates: true
  });

  await prisma.communicationTemplate.createMany({
    data: [
      {
        id: "demo-template-registration-confirmation",
        name: "DEMO Registration Confirmation",
        subject: "Your cohort registration is confirmed",
        bodyHtml: "<p>Demo confirmation email.</p>",
        bodyText: "Demo confirmation email.",
        type: TemplateType.REGISTRATION_CONFIRMATION
      },
      {
        id: "demo-template-payment-reminder",
        name: "DEMO Payment Reminder",
        subject: "Payment reminder for your cohort registration",
        bodyHtml: "<p>Demo payment reminder.</p>",
        bodyText: "Demo payment reminder.",
        type: TemplateType.PAYMENT_REMINDER
      }
    ],
    skipDuplicates: true
  });

  await prisma.cohortCommunication.upsert({
    where: { id: "demo-communication-week-reminder" },
    update: {},
    create: {
      id: "demo-communication-week-reminder",
      cohortId: cohortA.id,
      sessionId: sessionA1.id,
      subject: "DEMO One week reminder",
      bodyHtml: "<p>Demo scheduled reminder.</p>",
      bodyText: "Demo scheduled reminder.",
      scheduledFor: new Date("2026-05-05T14:00:00.000Z"),
      status: CommunicationStatus.SCHEDULED,
      recipientScope: RecipientScope.ALL_PARTICIPANTS,
      createdById: admin.id
    }
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      entityType: "Seed",
      entityId: "demo",
      action: "SEEDED",
      description: "Demo seed data created",
      metadata: { demo: true, organizations: [northview.id, cedar.id] }
    }
  });
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
