import { CohortStatus, CommunicationStatus, EmailEventType, OperationsTaskStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isMissingEmailReviewColumn } from "@/lib/prismaCompatibility";
import { deriveCohortStatus } from "@/services/cohortLifecycle";

function parseDashboardRange(request: Request) {
  const params = new URL(request.url).searchParams;
  const rangeStart = params.get("rangeStart");
  const rangeEnd = params.get("rangeEnd");

  if (!rangeStart || !rangeEnd) {
    return null;
  }

  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return null;
  }

  return { start, end };
}

function parseDashboardFilters(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    cohortId: params.get("cohortId") || "",
    presenterId: params.get("presenterId") || "",
    cohortScope: params.get("cohortScope") || ""
  };
}

function dashboardCohortWhere(filters: ReturnType<typeof parseDashboardFilters>) {
  const where: Record<string, unknown> = {};

  if (filters.cohortId) {
    where.id = filters.cohortId;
  }

  if (filters.presenterId) {
    where.presenterId = filters.presenterId;
  }

  if (filters.cohortScope === "active") {
    where.status = { in: [CohortStatus.PUBLISHED, CohortStatus.ACTIVE] };
  }

  return where;
}

function dashboardCohortRelationWhere(filters: ReturnType<typeof parseDashboardFilters>) {
  const cohort = dashboardCohortWhere(filters);
  return Object.keys(cohort).length ? { cohort } : {};
}

function dateRangeWhere(range: { start: Date; end: Date } | null) {
  return range ? { gte: range.start, lt: range.end } : undefined;
}

function paymentRangeWhere(range: { start: Date; end: Date } | null) {
  const where = dateRangeWhere(range);

  if (!where) {
    return {};
  }

  return {
    OR: [
      { paymentDate: where },
      { paymentDate: null, createdAt: where }
    ]
  };
}

function taskRangeWhere(range: { start: Date; end: Date } | null) {
  const where = dateRangeWhere(range);

  if (!where) {
    return {};
  }

  return {
    OR: [
      { dueDate: where },
      { dueDate: null, createdAt: where }
    ]
  };
}

function cohortOverlapsRange(cohort: { startDate: Date; endDate: Date; sessions?: Array<{ startTime: Date }> }, range: { start: Date; end: Date } | null) {
  if (!range) {
    return true;
  }

  const cohortDatesOverlap = cohort.startDate < range.end && cohort.endDate >= range.start;
  const sessionDatesOverlap = cohort.sessions?.some((session) => session.startTime >= range.start && session.startTime < range.end) ?? false;
  return cohortDatesOverlap || sessionDatesOverlap;
}

async function dashboardCommunicationIssues(where: Record<string, unknown>, filters: ReturnType<typeof parseDashboardFilters>) {
  const cohort = dashboardCohortWhere(filters);
  try {
    return await prisma.emailEvent.findMany({
      where: {
        eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] },
        ...where,
        ...(Object.keys(cohort).length ? { communication: { cohort } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { communication: { include: { cohort: true, session: true } } }
    });
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    return [];
  }
}

export async function GET(request: Request) {
  const now = new Date();
  const range = parseDashboardRange(request);
  const filters = parseDashboardFilters(request);
  const cohortWhere = dashboardCohortWhere(filters);
  const cohortRelationWhere = dashboardCohortRelationWhere(filters);
  const rangeDateWhere = dateRangeWhere(range);
  const sessionMetricWhere = rangeDateWhere ? { startTime: rangeDateWhere } : { startTime: { gte: now } };
  const registrationMetricWhere = rangeDateWhere ? { createdAt: rangeDateWhere } : {};
  const participantMetricWhere = rangeDateWhere ? { createdAt: rangeDateWhere } : {};
  const communicationIssueWhere = rangeDateWhere ? { createdAt: rangeDateWhere, reviewedAt: null } : { reviewedAt: null };
  const scheduledCommunicationWhere = rangeDateWhere ? { scheduledFor: rangeDateWhere } : {};
  const paymentSnapshotWhere = paymentRangeWhere(range);
  const openTaskSnapshotWhere = taskRangeWhere(range);

  const [
    lifecycleCohorts,
    upcomingSessions,
    openRegistrations,
    totalParticipants,
    pendingPayments,
    scheduledCommunications,
    openOperationsTasks,
    sessions,
    registrations,
    cohorts,
    tasks,
    communicationIssues,
    paymentSnapshot,
    paymentRecords,
    activity
  ] = await Promise.all([
    prisma.cohort.findMany({
      where: cohortWhere,
      include: {
        sessions: {
          orderBy: { startTime: "asc" },
          include: { communications: { include: { template: true } } }
        }
      }
    }),
    prisma.cohortSession.count({ where: { ...sessionMetricWhere, ...cohortRelationWhere } }),
    prisma.registration.count({ where: { archivedAt: null, status: { in: [RegistrationStatus.NEW, RegistrationStatus.CONFIRMED] }, ...registrationMetricWhere, ...cohortRelationWhere } }),
    prisma.participant.count({ where: { ...participantMetricWhere, ...cohortRelationWhere } }),
    prisma.paymentRecord.count({ where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.INVOICED, PaymentStatus.PARTIALLY_PAID] }, ...paymentSnapshotWhere, ...cohortRelationWhere } }),
    prisma.cohortCommunication.count({ where: { status: CommunicationStatus.SCHEDULED, ...scheduledCommunicationWhere, ...cohortRelationWhere } }),
    prisma.operationsTask.count({ where: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }, ...openTaskSnapshotWhere, ...cohortRelationWhere } }),
    prisma.cohortSession.findMany({
      where: { startTime: { gte: now }, ...cohortRelationWhere },
      orderBy: { startTime: "asc" },
      take: 6,
      include: { cohort: { include: { presenter: true } } }
    }),
    prisma.registration.findMany({
      where: { archivedAt: null, ...cohortRelationWhere },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { cohort: true, organization: true }
    }),
    prisma.cohort.findMany({
      where: {
        ...cohortWhere,
        OR: [
          { status: CohortStatus.DRAFT },
          { operationsTasks: { some: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] } } } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { presenter: true, _count: { select: { registrations: true, participants: true } } }
    }),
    prisma.operationsTask.findMany({
      where: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }, ...cohortRelationWhere },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 8,
      include: { cohort: true, registration: { include: { organization: true } }, session: true }
    }),
    dashboardCommunicationIssues(communicationIssueWhere, filters),
    prisma.paymentRecord.groupBy({
      by: ["status"],
      where: { ...paymentSnapshotWhere, ...cohortRelationWhere },
      _count: { status: true },
      _sum: { amount: true }
    }),
    prisma.paymentRecord.findMany({
      where: { ...paymentSnapshotWhere, ...cohortRelationWhere },
      select: {
        id: true,
        cohortId: true,
        status: true,
        amount: true,
        cohort: { select: { id: true, title: true, thumbnailUrl: true } }
      }
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);
  const activeCohortStatuses: CohortStatus[] = [CohortStatus.PUBLISHED, CohortStatus.ACTIVE];
  const activeCohorts = lifecycleCohorts.filter((cohort) => activeCohortStatuses.includes(deriveCohortStatus(cohort)) && cohortOverlapsRange(cohort, range)).length;

  return ok({
    metrics: {
      activeCohorts,
      upcomingSessions,
      openRegistrations,
      totalParticipants,
      pendingPayments,
      scheduledCommunications,
      openOperationsTasks,
      communicationIssues: communicationIssues.length
    },
    upcomingSessions: sessions,
    recentRegistrations: registrations,
    cohortsNeedingAttention: cohorts,
    openOperationsTasks: tasks,
    communicationIssues,
    paymentStatusSnapshot: paymentSnapshot,
    paymentRecordsSnapshot: paymentRecords,
    recentActivity: activity
  });
}
