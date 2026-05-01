import { randomBytes } from "node:crypto";
import { PaymentStatus, ReportShareStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getCohortReport(cohortId?: string) {
  const where = cohortId ? { id: cohortId } : undefined;
  const cohorts = await prisma.cohort.findMany({
    where,
    orderBy: { startDate: "desc" },
    include: {
      sessions: true,
      registrations: { include: { organization: true, participants: true, paymentRecords: true } },
      participants: true,
      communications: true,
      operationsTasks: true
    }
  });

  return cohorts.map((cohort) => {
    const registrations = cohort.registrations;
    const payments = registrations.flatMap((registration) => registration.paymentRecords);
    const participantCountByOrganization = registrations.reduce<Record<string, number>>((acc, registration) => {
      acc[registration.organization.name] = (acc[registration.organization.name] ?? 0) + registration.participants.length;
      return acc;
    }, {});
    const paymentStatusSummary = payments.reduce<Record<string, number>>((acc, payment) => {
      acc[payment.status] = (acc[payment.status] ?? 0) + 1;
      return acc;
    }, {});
    const communicationStatusSummary = cohort.communications.reduce<Record<string, number>>((acc, communication) => {
      acc[communication.status] = (acc[communication.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      cohort: {
        id: cohort.id,
        title: cohort.title,
        slug: cohort.slug,
        status: cohort.status,
        startDate: cohort.startDate,
        endDate: cohort.endDate
      },
      registrationSummary: {
        total: registrations.length,
        confirmed: registrations.filter((registration) => registration.status === "CONFIRMED").length,
        cancelled: registrations.filter((registration) => registration.status === "CANCELLED").length,
        openRosterItems: registrations.filter((registration) => ["NEEDED", "PARTIAL"].includes(registration.participantListStatus)).length
      },
      participantSummary: {
        total: cohort.participants.length,
        byOrganization: participantCountByOrganization
      },
      paymentSummary: {
        totalAmount: registrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0),
        pendingAmount: payments
          .filter((payment) => [PaymentStatus.PENDING, PaymentStatus.INVOICED, PaymentStatus.PARTIALLY_PAID].includes(payment.status))
          .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
        byStatus: paymentStatusSummary
      },
      communicationSummary: communicationStatusSummary,
      readiness: {
        sessions: cohort.sessions.length,
        openTasks: cohort.operationsTasks.filter((task) => task.status !== "COMPLETED").length,
        scheduledCommunications: cohort.communications.filter((communication) => communication.status === "SCHEDULED").length
      }
    };
  });
}

export async function createReportShareLink(input: {
  cohortId?: string;
  title: string;
  reportType?: string;
  expiresAt?: Date;
  createdById?: string;
}) {
  return prisma.reportShareLink.create({
    data: {
      token: randomBytes(24).toString("hex"),
      cohortId: input.cohortId,
      title: input.title,
      reportType: input.reportType ?? "cohort_summary",
      expiresAt: input.expiresAt,
      createdById: input.createdById
    }
  });
}

export async function revokeReportShareLink(id: string) {
  return prisma.reportShareLink.update({
    where: { id },
    data: { status: ReportShareStatus.REVOKED, revokedAt: new Date() }
  });
}

export async function listReportShareLinks() {
  return prisma.reportShareLink.findMany({
    orderBy: { createdAt: "desc" },
    include: { cohort: true }
  });
}

export async function getSharedReport(token: string) {
  const link = await prisma.reportShareLink.findUnique({ where: { token } });

  if (!link || link.status !== ReportShareStatus.ACTIVE || (link.expiresAt && link.expiresAt < new Date())) {
    throw Object.assign(new Error("Report link is expired or unavailable."), {
      code: "NOT_FOUND",
      status: 404
    });
  }

  return {
    link: {
      title: link.title,
      reportType: link.reportType,
      expiresAt: link.expiresAt
    },
    data: await getCohortReport(link.cohortId ?? undefined)
  };
}
