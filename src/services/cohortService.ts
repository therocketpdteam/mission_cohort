import { CohortStatus, CohortType } from "@prisma/client";
import { z } from "zod";
import { dateInput, ensureEndAfterStart, positiveIntInput } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { cohortCreateSchema, cohortUpdateSchema } from "@/validators/cohort";
import { logAuditEventAsync } from "./auditService";
import { createDefaultSessionCommunications } from "./communicationService";
import { prepareCohortCalendarInvites } from "./calendarService";
import { getCohortReadiness, withCohortLifecycle } from "./cohortLifecycle";
import { activateCohortRegistrationJourneys } from "./registrationJourneyService";
import { syncCohortQuickBooksProjectAfterCreate } from "./quickBooksService";

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
        cohortType: CohortType.LIVE_VIRTUAL,
        pricePerParticipant: 0,
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
  const cohort = await prisma.cohort.update({ where: { id }, data });
  logAuditEventAsync({
    entityType: "Cohort",
    entityId: cohort.id,
    action: "UPDATED",
    description: "Cohort updated",
    metadata: { title: cohort.title, status: cohort.status }
  });
  return cohort;
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
      registrations: { select: { totalAmount: true } },
      paymentRecords: { select: { amount: true, status: true } },
      _count: { select: { registrations: true, participants: true, sessions: true } }
    }
  });

  return cohorts.map(withCohortLifecycle);
}

export async function publishCohort(id: string) {
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

  const readiness = getCohortReadiness(cohort);
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
