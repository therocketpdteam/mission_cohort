import { randomBytes } from "node:crypto";
import { ParticipantListStatus, PaymentStatus, Prisma, RegistrationStatus, ReportShareStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const pendingPaymentStatuses = new Set<PaymentStatus>([
  PaymentStatus.PENDING,
  PaymentStatus.INVOICED,
  PaymentStatus.PARTIALLY_PAID
]);
const openRosterStatuses = new Set<ParticipantListStatus>([
  ParticipantListStatus.NEEDED,
  ParticipantListStatus.PARTIAL
]);
const internalReportColumns = new Set(["pocEmail", "pocPhone", "paymentMethod", "notes", "invoiceRefs", "participantNames"]);

type CohortRegistrationReportInput = {
  cohortId: string;
  audience?: "thought_leader" | "internal";
  registrationStatus?: string;
  paymentStatus?: string;
  rosterStatus?: string;
  cityState?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  includeArchived?: boolean;
  columns?: string[];
};

function toDateStart(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function toDateEndExclusive(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function monthKey(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

function moneyNumber(value: unknown) {
  return Number(value ?? 0);
}

function sourceLabel(registration: { source?: string | null; utmSource?: string | null; utmCampaign?: string | null; externalSource?: string | null }) {
  return registration.utmCampaign || registration.utmSource || registration.source || registration.externalSource || "Unknown";
}

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
        openRosterItems: registrations.filter((registration) => openRosterStatuses.has(registration.participantListStatus)).length
      },
      participantSummary: {
        total: cohort.participants.length,
        byOrganization: participantCountByOrganization
      },
      paymentSummary: {
        totalAmount: registrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0),
        pendingAmount: payments
          .filter((payment) => pendingPaymentStatuses.has(payment.status))
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

export async function getCohortRegistrationReport(input: CohortRegistrationReportInput) {
  const audience = input.audience === "internal" ? "internal" : "thought_leader";
  const requestedColumns = (input.columns ?? []).filter((column) => audience === "internal" || !internalReportColumns.has(column));
  const where: Prisma.RegistrationWhereInput = {
    cohortId: input.cohortId,
    ...(input.includeArchived ? {} : { archivedAt: null })
  };

  if (input.registrationStatus && input.registrationStatus in RegistrationStatus) {
    where.status = input.registrationStatus as RegistrationStatus;
  }

  if (input.paymentStatus && input.paymentStatus in PaymentStatus) {
    where.paymentStatus = input.paymentStatus as PaymentStatus;
  }

  if (input.rosterStatus && input.rosterStatus in ParticipantListStatus) {
    where.participantListStatus = input.rosterStatus as ParticipantListStatus;
  }

  const dateFrom = toDateStart(input.dateFrom);
  const dateTo = toDateEndExclusive(input.dateTo);
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lt: dateTo } : {})
    };
  }

  const cityState = input.cityState?.trim();
  if (cityState) {
    where.OR = [
      { organization: { city: { contains: cityState, mode: "insensitive" } } },
      { organization: { state: { contains: cityState, mode: "insensitive" } } }
    ];
  }

  const source = input.source?.trim();
  if (source) {
    const sourceFilter: Prisma.RegistrationWhereInput[] = [
      { source: { contains: source, mode: "insensitive" } },
      { utmSource: { contains: source, mode: "insensitive" } },
      { utmCampaign: { contains: source, mode: "insensitive" } },
      { externalSource: { contains: source, mode: "insensitive" } }
    ];
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: sourceFilter }];
  }

  const cohort = await prisma.cohort.findUnique({
    where: { id: input.cohortId },
    include: {
      registrations: {
        where,
        orderBy: { createdAt: "asc" },
        include: { organization: true, participants: true, paymentRecords: true }
      }
    }
  });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found."), { code: "NOT_FOUND", status: 404 });
  }

  const registrations = cohort.registrations;
  const summary = registrations.reduce(
    (acc, registration) => {
      const totalAmount = moneyNumber(registration.totalAmount);
      const paidFromRecords = registration.paymentRecords
        .filter((payment) => payment.status === PaymentStatus.PAID)
        .reduce((sum, payment) => sum + moneyNumber(payment.amount), 0);
      const paidAmount = paidFromRecords || (registration.paymentStatus === PaymentStatus.PAID ? totalAmount : 0);

      acc.totalRegistrations += 1;
      acc.participantSeats += Number(registration.participantCount ?? registration.participants.length ?? 0);
      acc.totalSold += totalAmount;
      acc.paidAmount += paidAmount;
      acc.pendingAmount += Math.max(totalAmount - paidAmount, 0);
      if (cityState) acc.geographicMatches += 1;
      else if (registration.organization.city || registration.organization.state) acc.geographicMatches += 1;

      return acc;
    },
    { totalRegistrations: 0, participantSeats: 0, totalSold: 0, paidAmount: 0, pendingAmount: 0, geographicMatches: 0 }
  );

  const monthlyBreakdown = Object.values(registrations.reduce<Record<string, { label: string; registrations: number; amount: number }>>((acc, registration) => {
    const key = monthKey(registration.createdAt);
    acc[key] = acc[key] ?? { label: key, registrations: 0, amount: 0 };
    acc[key].registrations += 1;
    acc[key].amount += moneyNumber(registration.totalAmount);
    return acc;
  }, {}));

  const sourceBreakdown = Object.values(registrations.reduce<Record<string, { label: string; registrations: number; amount: number }>>((acc, registration) => {
    const key = sourceLabel(registration);
    acc[key] = acc[key] ?? { label: key, registrations: 0, amount: 0 };
    acc[key].registrations += 1;
    acc[key].amount += moneyNumber(registration.totalAmount);
    return acc;
  }, {})).sort((a, b) => b.registrations - a.registrations);

  const strongestMonth = monthlyBreakdown.slice().sort((a, b) => b.registrations - a.registrations)[0];
  const strongestSource = sourceBreakdown[0];
  const recommendedOutreachNote = registrations.length === 0
    ? "No matching registrations yet. Use this report as a baseline and revisit after the next outreach push."
    : `Current sign-ups are strongest${strongestMonth ? ` in ${strongestMonth.label}` : ""}${strongestSource ? `, led by ${strongestSource.label}` : ""}. Use the next outreach touchpoint shortly before that timing window and reference the strongest geography/source signals in the message.`;

  return {
    cohort: {
      id: cohort.id,
      title: cohort.title,
      slug: cohort.slug,
      status: cohort.status,
      startDate: cohort.startDate,
      endDate: cohort.endDate
    },
    generatedAt: new Date().toISOString(),
    audience,
    columns: requestedColumns,
    filters: {
      registrationStatus: input.registrationStatus || "",
      paymentStatus: input.paymentStatus || "",
      rosterStatus: input.rosterStatus || "",
      cityState: cityState || "",
      dateFrom: input.dateFrom || "",
      dateTo: input.dateTo || "",
      source: source || "",
      includeArchived: Boolean(input.includeArchived)
    },
    summary,
    registrations: registrations.map((registration) => ({
      id: registration.id,
      organization: registration.organization.name,
      city: registration.organization.city,
      state: registration.organization.state,
      pocName: registration.primaryContactName,
      ...(audience === "internal" ? {
        pocEmail: registration.primaryContactEmail,
        pocPhone: registration.primaryContactPhone,
        notes: registration.notes,
        invoiceNumber: registration.invoiceNumber,
        purchaseOrderNumber: registration.purchaseOrderNumber,
        participantNames: registration.participants.map((participant) => `${participant.firstName} ${participant.lastName}`.trim()).filter(Boolean)
      } : {}),
      participants: registration.participantCount || registration.participants.length,
      amount: moneyNumber(registration.totalAmount),
      paymentStatus: registration.paymentStatus,
      paymentMethod: audience === "internal" ? registration.paymentMethod : undefined,
      rosterStatus: registration.participantListStatus,
      registrationStatus: registration.status,
      source: sourceLabel(registration),
      createdAt: registration.createdAt.toISOString(),
      archivedAt: registration.archivedAt?.toISOString() ?? null
    })),
    monthlyBreakdown,
    sourceBreakdown,
    recommendedOutreachNote
  };
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
