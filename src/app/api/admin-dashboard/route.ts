import { CohortStatus, CommunicationStatus, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();

  const [
    activeCohorts,
    upcomingSessions,
    openRegistrations,
    totalParticipants,
    pendingPayments,
    scheduledCommunications,
    sessions,
    registrations,
    cohorts,
    paymentSnapshot,
    activity
  ] = await Promise.all([
    prisma.cohort.count({ where: { status: { in: [CohortStatus.REGISTRATION_OPEN, CohortStatus.ACTIVE, CohortStatus.PUBLISHED] } } }),
    prisma.cohortSession.count({ where: { startTime: { gte: now } } }),
    prisma.registration.count({ where: { status: { in: [RegistrationStatus.NEW, RegistrationStatus.CONFIRMED] } } }),
    prisma.participant.count(),
    prisma.paymentRecord.count({ where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.INVOICED, PaymentStatus.PARTIALLY_PAID] } } }),
    prisma.cohortCommunication.count({ where: { status: CommunicationStatus.SCHEDULED } }),
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
      where: { status: { in: [CohortStatus.DRAFT, CohortStatus.REGISTRATION_OPEN, CohortStatus.REGISTRATION_CLOSED] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { presenter: true, _count: { select: { registrations: true, participants: true } } }
    }),
    prisma.paymentRecord.groupBy({
      by: ["status"],
      _count: { status: true },
      _sum: { amount: true }
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);

  return ok({
    metrics: {
      activeCohorts,
      upcomingSessions,
      openRegistrations,
      totalParticipants,
      pendingPayments,
      scheduledCommunications
    },
    upcomingSessions: sessions,
    recentRegistrations: registrations,
    cohortsNeedingAttention: cohorts,
    paymentStatusSnapshot: paymentSnapshot,
    recentActivity: activity
  });
}
