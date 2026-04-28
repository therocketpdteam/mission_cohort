import { CohortStatus, CohortType } from "@prisma/client";
import { z } from "zod";
import { dateInput, ensureEndAfterStart, positiveIntInput } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { cohortCreateSchema, cohortUpdateSchema } from "@/validators/cohort";
import { logAuditEventAsync } from "./auditService";
import { createDefaultSessionOperationsTasks } from "./operationsTaskService";

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
    void createDefaultSessionOperationsTasks({
      cohortId: cohort.id,
      sessionId: session.id,
      sessionTitle: session.title
    });
  }

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
  return prisma.cohort.findUnique({
    where: { id },
    include: {
      presenter: true,
      sessions: { orderBy: { sessionNumber: "asc" } },
      registrationForms: true,
      _count: { select: { registrations: true, participants: true, communications: true } }
    }
  });
}

export async function listCohorts() {
  return prisma.cohort.findMany({
    orderBy: { startDate: "desc" },
    include: {
      presenter: true,
      _count: { select: { registrations: true, participants: true, sessions: true } }
    }
  });
}

export async function publishCohort(id: string) {
  return updateCohort(id, { status: CohortStatus.PUBLISHED });
}

export async function archiveCohort(id: string) {
  return updateCohort(id, { status: CohortStatus.ARCHIVED });
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
