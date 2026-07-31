import { CohortStatus, CommunicationStatus } from "@prisma/client";
import { z } from "zod";
import { dateInput, ensureEndAfterStart, positiveIntInput } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { cohortCreateSchema, cohortUpdateSchema } from "@/validators/cohort";
import { logAuditEventAsync } from "./auditService";
import { createDefaultCohortSessionCommunications, createDefaultSessionCommunications } from "./communicationService";
import { prepareCohortCalendarInvites } from "./calendarService";
import { withCohortLifecycle } from "./cohortLifecycle";
import { activateCohortRegistrationJourneys } from "./registrationJourneyService";
import { syncCohortQuickBooksProjectAfterCreate } from "./quickBooksService";
import { syncCohortTotalsToCrm } from "./crmRegistrationWebhookService";

const nestedSessionCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sessionNumber: positiveIntInput,
  startTime: dateInput,
  endTime: dateInput,
  timezone: z.string().min(1),
  meetingUrl: z.string().url().optional(),
  location: z.string().optional()
}).superRefine(ensureEndAfterStart);

const cohortWithSessionsCreateSchema = cohortCreateSchema.and(z.object({
  sessions: z.array(nestedSessionCreateSchema).min(1)
}));

export async function createCohort(input: z.input<typeof cohortCreateSchema>) {
  const data = cohortCreateSchema.parse(input);
  const cohort = await prisma.cohort.create({ data });
  logAuditEventAsync({
    entityType: "Cohort",
    entityId: cohort.id,
    action: "CREATED",
    description: "Cohort created",
    metadata: { title: cohort.title, slug: cohort.slug }
  });
  await syncCohortQuickBooksProjectAfterCreate(cohort.id);
  return cohort;
}

export async function createCohortWithSessions(input: z.input<typeof cohortWithSessionsCreateSchema>) {
  const { sessions, ...cohortInput } = cohortWithSessionsCreateSchema.parse(input);
  const sortedSessions = [...sessions].sort((a, b) => a.sessionNumber - b.sessionNumber);
  const firstSession = sortedSessions[0]!;
  const lastSession = sortedSessions[sortedSessions.length - 1]!;

  const cohort = await prisma.$transaction(async (tx) => {
    const createdCohort = await tx.cohort.create({
      data: {
        ...cohortInput,
        startDate: firstSession.startTime,
        endDate: lastSession.endTime,
        defaultTimezone: firstSession.timezone
      }
    });

    await tx.cohortSession.createMany({
      data: sortedSessions.map((session) => ({
        ...session,
        cohortId: createdCohort.id
      }))
    });

    return tx.cohort.findUniqueOrThrow({
      where: { id: createdCohort.id },
      include: {
        presenter: true,
        sessions: { orderBy: { sessionNumber: "asc" } },
        _count: { select: { registrations: true, participants: true, sessions: true } }
      }
    });
  });

  logAuditEventAsync({
    entityType: "Cohort",
    entityId: cohort.id,
    action: "CREATED",
    description: "Cohort created with sessions",
    metadata: { title: cohort.title, slug: cohort.slug, sessions: cohort.sessions.length }
  });

  for (const session of cohort.sessions) {
    await createDefaultSessionCommunications(session.id);
  }

  await syncCohortQuickBooksProjectAfterCreate(cohort.id);

  return cohort;
}

export async function updateCohort(id: string, input: z.input<typeof cohortUpdateSchema>) {
  const data = cohortUpdateSchema.parse(input);
  const existing = await prisma.cohort.findUnique({ where: { id }, select: { status: true } });

  if (!existing) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const pausableStatuses = [
    CommunicationStatus.DRAFT,
    CommunicationStatus.SCHEDULED,
    CommunicationStatus.SENDING,
    CommunicationStatus.FAILED
  ];
  const nextStatus = data.status;
  const shouldCancelUnsentCommunications = nextStatus === CohortStatus.CANCELLED && existing.status !== CohortStatus.CANCELLED;
  const transaction = await prisma.$transaction(async (tx) => {
    const cohort = await tx.cohort.update({ where: { id }, data });
    const cancelledCommunications = shouldCancelUnsentCommunications
      ? await tx.cohortCommunication.updateMany({
        where: {
          cohortId: id,
          sentAt: null,
          status: { in: pausableStatuses }
        },
        data: {
          status: CommunicationStatus.CANCELLED,
          providerError: "Cancelled because cohort status changed to Cancelled."
        }
      })
      : { count: 0 };

    return { cohort, cancelledCommunications };
  });
  const { cohort, cancelledCommunications } = transaction;

  logAuditEventAsync({
    entityType: "Cohort",
    entityId: cohort.id,
    action: "UPDATED",
    description: "Cohort updated",
    metadata: {
      title: cohort.title,
      status: cohort.status,
      previousStatus: existing.status,
      cancelledCommunications: cancelledCommunications.count
    }
  });
  void syncCohortTotalsToCrm(cohort.id, "cohort.updated").catch((error) => {
    console.error("CRM Mission Cohort cohort sync scheduling failed", { cohortId: cohort.id, error: error instanceof Error ? error.message : "Unknown error" });
  });
  return cohort;
}

export async function getCohortStatusChangePreview(id: string, nextStatus: CohortStatus) {
  const cohort = await prisma.cohort.findUnique({
    where: { id },
    include: {
      sessions: {
        orderBy: { sessionNumber: "asc" },
        include: { calendarEvents: true }
      },
      _count: { select: { registrations: true, participants: true } }
    }
  });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const unsentStatuses = [
    CommunicationStatus.DRAFT,
    CommunicationStatus.SCHEDULED,
    CommunicationStatus.SENDING,
    CommunicationStatus.FAILED
  ];
  const [unsentCommunications, recentSentCommunications] = await Promise.all([
    prisma.cohortCommunication.findMany({
      where: {
        cohortId: id,
        sentAt: null,
        status: { in: unsentStatuses }
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
      take: 25,
      include: { template: true, session: true }
    }),
    prisma.cohortCommunication.findMany({
      where: {
        cohortId: id,
        status: CommunicationStatus.SENT,
        sentAt: { not: null }
      },
      orderBy: { sentAt: "desc" },
      take: 10,
      include: { template: true, session: true }
    })
  ]);
  const linkedCalendarEvents = cohort.sessions.flatMap((session) =>
    session.calendarEvents
      .filter((event) => event.providerEventId && event.status !== "FAILED")
      .map((event) => ({
        id: event.id,
        sessionId: session.id,
        sessionTitle: session.title,
        provider: event.provider,
        status: event.status,
        startTime: session.startTime
      }))
  );

  return {
    cohort: {
      id: cohort.id,
      title: cohort.title,
      currentStatus: cohort.status,
      nextStatus,
      participantCount: cohort._count.participants,
      registrationCount: cohort._count.registrations
    },
    automaticEmails: [],
    unsentCommunications: unsentCommunications.map((communication) => ({
      id: communication.id,
      subject: communication.subject,
      status: communication.status,
      scheduledFor: communication.scheduledFor,
      templateName: communication.template?.name ?? null,
      templateType: communication.template?.type ?? null,
      sessionTitle: communication.session?.title ?? null,
      action: nextStatus === CohortStatus.CANCELLED ? "will_be_cancelled" : "no_change"
    })),
    recentSentCommunications: recentSentCommunications.map((communication) => ({
      id: communication.id,
      subject: communication.subject,
      sentAt: communication.sentAt,
      templateName: communication.template?.name ?? null,
      templateType: communication.template?.type ?? null,
      sessionTitle: communication.session?.title ?? null,
      recipientEmails: communication.recipientEmails
    })),
    linkedCalendarEvents,
    warnings: nextStatus === CohortStatus.CANCELLED
      ? [
        "Changing the cohort status to Cancelled will not send email automatically.",
        "Unsent draft, scheduled, failed, or sending communications will be cancelled so they do not send later.",
        "Linked Google Calendar events are not removed by this status change. Use calendar cancellation separately only if you want Google to notify invitees."
      ]
      : []
  };
}

export async function getCohortById(id: string) {
  const cohort = await prisma.cohort.findUnique({
    where: { id },
    include: {
      presenter: true,
      sessions: {
        orderBy: { sessionNumber: "asc" },
        include: {
          calendarEvents: true,
          communications: { include: { template: true } }
        }
      },
      operationsTasks: true,
      registrationForms: true,
      _count: { select: { registrations: true, participants: true, communications: true } }
    }
  });

  return cohort ? withCohortLifecycle(cohort) : null;
}

export async function listCohorts() {
  const cohorts = await prisma.cohort.findMany({
    orderBy: { startDate: "desc" },
    include: {
      presenter: true,
      sessions: {
        orderBy: { sessionNumber: "asc" },
        include: {
          calendarEvents: true,
          communications: { include: { template: true } }
        }
      },
      operationsTasks: { select: { category: true, registrationId: true, sessionId: true, status: true } },
      registrations: { where: { archivedAt: null }, select: { totalAmount: true } },
      paymentRecords: {
        where: { registration: { is: { archivedAt: null } } },
        select: { amount: true, status: true }
      },
      _count: { select: { registrations: true, participants: true, sessions: true } }
    }
  });

  return cohorts.map(withCohortLifecycle);
}

export async function publishCohort(id: string) {
  await createDefaultCohortSessionCommunications(id);

  const cohort = await prisma.cohort.findUnique({
    where: { id },
    include: {
      sessions: {
        include: {
          calendarEvents: true,
          communications: { include: { template: true } }
        }
      },
      operationsTasks: { select: { category: true, registrationId: true, sessionId: true, status: true } }
    }
  });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const readiness = withCohortLifecycle(cohort).readiness;
  if (!readiness.ready) {
    const blockers = readiness.items.filter((item) => !item.ready).map((item) => item.label).join(", ");
    throw Object.assign(new Error(`Cohort is not ready to publish: ${blockers}`), { code: "COHORT_NOT_READY", status: 409 });
  }

  const published = await updateCohort(id, { status: CohortStatus.PUBLISHED });
  let journey: Awaited<ReturnType<typeof activateCohortRegistrationJourneys>> | { status: "needs_attention"; error: string };
  try {
    journey = await activateCohortRegistrationJourneys(id);
  } catch (error) {
    journey = {
      status: "needs_attention",
      error: error instanceof Error ? error.message : "Registration communication activation failed"
    };
  }
  try {
    const delivery = await prepareCohortCalendarInvites({ cohortId: id, mode: "auto", fallbackToIcs: false });
    return { ...published, journey, delivery };
  } catch (error) {
    return {
      ...published,
      journey,
      delivery: {
        status: "needs_attention" as const,
        error: error instanceof Error ? error.message : "Calendar invitation delivery failed"
      }
    };
  }
}

export async function moveCohortBackToDraft(id: string) {
  const cohort = await prisma.cohort.findUnique({ where: { id }, select: { id: true, title: true, status: true } });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const draftableStatuses: CohortStatus[] = [CohortStatus.PUBLISHED, CohortStatus.ACTIVE];

  if (!draftableStatuses.includes(cohort.status)) {
    throw Object.assign(new Error("Only Published or Active cohorts can be moved back to Draft."), { code: "BAD_REQUEST", status: 400 });
  }

  const pausableStatuses = [
    CommunicationStatus.DRAFT,
    CommunicationStatus.SCHEDULED,
    CommunicationStatus.SENDING,
    CommunicationStatus.FAILED
  ];

  const [updated, pausedCommunications] = await prisma.$transaction([
    prisma.cohort.update({ where: { id }, data: { status: CohortStatus.DRAFT } }),
    prisma.cohortCommunication.updateMany({
      where: {
        cohortId: id,
        sentAt: null,
        status: { in: pausableStatuses }
      },
      data: {
        status: CommunicationStatus.DRAFT,
        providerError: "Paused because cohort was moved back to Draft."
      }
    })
  ]);

  logAuditEventAsync({
    entityType: "Cohort",
    entityId: id,
    action: "UPDATED",
    description: "Cohort moved back to Draft and unsent communications paused",
    metadata: { title: cohort.title, previousStatus: cohort.status, pausedCommunications: pausedCommunications.count }
  });

  void syncCohortTotalsToCrm(id, "cohort.moved_to_draft").catch((error) => {
    console.error("CRM Mission Cohort cohort sync scheduling failed", { cohortId: id, error: error instanceof Error ? error.message : "Unknown error" });
  });

  return { ...updated, pausedCommunications: pausedCommunications.count };
}

export async function archiveCohort(id: string) {
  return updateCohort(id, { status: CohortStatus.CANCELLED });
}

export async function getCohortOperationalSummary(id: string) {
  const [cohort, registrations, participants, payments] = await Promise.all([
    getCohortById(id),
    prisma.registration.groupBy({
      by: ["status"],
      where: { cohortId: id },
      _count: { status: true }
    }),
    prisma.participant.groupBy({
      by: ["attendanceStatus"],
      where: { cohortId: id },
      _count: { attendanceStatus: true }
    }),
    prisma.paymentRecord.groupBy({
      by: ["status"],
      where: { cohortId: id },
      _sum: { amount: true },
      _count: { status: true }
    })
  ]);

  return { cohort, registrations, participants, payments };
}
