import { CohortStatus, CommunicationStatus, EmailEventType, OperationsTaskStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { deriveCohortStatus } from "@/services/cohortLifecycle";

export async function GET() {
  const now = new Date();

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
      include: {
        sessions: {
          include: { communications: { include: { template: true } } }
        }
      }
    }),
    prisma.cohortSession.count({ where: { startTime: { gte: now } } }),
    prisma.registration.count({ where: { status: { in: [RegistrationStatus.NEW, RegistrationStatus.CONFIRMED] } } }),
    prisma.participant.count(),
    prisma.paymentRecord.count({ where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.INVOICED, PaymentStatus.PARTIALLY_PAID] } } }),
    prisma.cohortCommunication.count({ where: { status: CommunicationStatus.SCHEDULED } }),
    prisma.operationsTask.count({ where: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] } } }),
    prisma.cohortSession.findMany({
      where: { startTime: { gte: now } },
      orderBy: { startTime: "asc" },
      take: 6,
      include: { cohort: true }
    }),
    prisma.registration.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { cohort: true, organization: true }
    }),
    prisma.cohort.findMany({
      where: {
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
      where: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 8,
      include: { cohort: true, registration: { include: { organization: true } }, session: true }
    }),
    prisma.emailEvent.findMany({
      where: { eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED, EmailEventType.UNSUBSCRIBED] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { communication: { include: { cohort: true, session: true } } }
    }),
    prisma.paymentRecord.groupBy({
      by: ["status"],
      _count: { status: true },
      _sum: { amount: true }
    }),
    prisma.paymentRecord.findMany({
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
  const activeCohorts = lifecycleCohorts.filter((cohort) => activeCohortStatuses.includes(deriveCohortStatus(cohort))).length;

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
