import { randomBytes } from "node:crypto";
import { ParticipantListStatus, PaymentStatus, Prisma, RegistrationStatus, ReportShareStatus } from "@prisma/client";
import { normalizeJotformRegistrationPayload } from "@/modules/jotform";
import { prisma } from "@/lib/prisma";
import { listActiveJotformFormMappings } from "@/services/jotformMappingService";

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
type ReportGeography = { city: string; state: string; zip: string };
type GeographyFallbackMap = Map<string, ReportGeography>;

type CohortRegistrationReportInput = {
  cohortId: string;
  audience?: "thought_leader" | "internal";
  registrationStatus?: string;
  paymentStatus?: string;
  rosterStatus?: string;
  cityState?: string;
  city?: string;
  state?: string;
  zip?: string;
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

function normalizedLookupValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function geographyFallbackKeys(input: { cohortId?: string | null; organizationName?: string | null; primaryContactEmail?: string | null }) {
  const cohortId = normalizedLookupValue(input.cohortId);
  const organizationName = normalizedLookupValue(input.organizationName);
  const primaryContactEmail = normalizedLookupValue(input.primaryContactEmail);
  const keys = [];

  if (cohortId && primaryContactEmail) {
    keys.push(`${cohortId}|email:${primaryContactEmail}`);
  }

  if (cohortId && organizationName) {
    keys.push(`${cohortId}|org:${organizationName}`);
  }

  return keys;
}

async function buildJotformGeographyFallbackMap(
  cohortId: string,
  mappings: Awaited<ReturnType<typeof listActiveJotformFormMappings>>
): Promise<GeographyFallbackMap> {
  const events = await prisma.webhookEvent.findMany({
    where: { source: "jotform" },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { payload: true }
  });
  const fallbackMap: GeographyFallbackMap = new Map();

  for (const event of events) {
    try {
      const normalized = normalizeJotformRegistrationPayload(event.payload as Record<string, unknown>, mappings);
      const eventCohortId = normalized.routing.cohortId || normalized.registration.cohortId;

      if (eventCohortId !== cohortId) {
        continue;
      }

      const geography = {
        city: normalized.organization.city || "",
        state: normalized.organization.state || "",
        zip: normalized.organization.zip || ""
      };

      if (!geography.city && !geography.state && !geography.zip) {
        continue;
      }

      for (const key of geographyFallbackKeys({
        cohortId: eventCohortId,
        organizationName: normalized.organization.name,
        primaryContactEmail: normalized.registration.primaryContactEmail
      })) {
        if (!fallbackMap.has(key)) {
          fallbackMap.set(key, geography);
        }
      }
    } catch {
      continue;
    }
  }

  return fallbackMap;
}

export async function getCohortRegistrationReportOptions(cohortId: string) {
  const mappings = await listActiveJotformFormMappings();
  const fallbackMap = await buildJotformGeographyFallbackMap(cohortId, mappings);
  const registrations = await prisma.registration.findMany({
    where: { cohortId, archivedAt: null },
    select: {
      cohortId: true,
      primaryContactEmail: true,
      organization: {
        select: {
          name: true,
          city: true,
          state: true,
          zip: true
        }
      },
      webhookEvents: {
        where: { source: "jotform" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { payload: true }
      }
    }
  });
  const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const geography = registrations.map((registration) => registrationGeography(registration, mappings, fallbackMap));

  return {
    cities: unique(geography.map((item) => item.city)),
    states: unique(geography.map((item) => item.state)),
    zips: unique(geography.map((item) => item.zip))
  };
}

function registrationGeography(
  registration: {
    cohortId?: string | null;
    primaryContactEmail?: string | null;
    organization: { name?: string | null; city?: string | null; state?: string | null; zip?: string | null };
    webhookEvents?: Array<{ payload: Prisma.JsonValue }>;
  },
  mappings: Awaited<ReturnType<typeof listActiveJotformFormMappings>>,
  fallbackMap?: GeographyFallbackMap
) {
  const fallback = registration.webhookEvents
    ?.map((event) => {
      try {
        return normalizeJotformRegistrationPayload(event.payload as Record<string, unknown>, mappings).organization;
      } catch {
        return null;
      }
    })
    .find((organization) => organization?.city || organization?.state || organization?.zip);
  const legacyFallback = geographyFallbackKeys({
    cohortId: registration.cohortId,
    organizationName: registration.organization.name,
    primaryContactEmail: registration.primaryContactEmail
  })
    .map((key) => fallbackMap?.get(key))
    .find((organization) => organization?.city || organization?.state || organization?.zip);

  return {
    city: registration.organization.city || fallback?.city || legacyFallback?.city || "",
    state: registration.organization.state || fallback?.state || legacyFallback?.state || "",
    zip: registration.organization.zip || fallback?.zip || legacyFallback?.zip || ""
  };
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
  const city = input.city?.trim();
  const state = input.state?.trim();
  const zip = input.zip?.trim();
  const andFilters: Prisma.RegistrationWhereInput[] = [];

  const source = input.source?.trim();
  if (source) {
    const sourceFilter: Prisma.RegistrationWhereInput[] = [
      { source: { contains: source, mode: "insensitive" } },
      { utmSource: { contains: source, mode: "insensitive" } },
      { utmCampaign: { contains: source, mode: "insensitive" } },
      { externalSource: { contains: source, mode: "insensitive" } }
    ];
    andFilters.push({ OR: sourceFilter });
  }

  if (andFilters.length > 0) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...andFilters];
  }

  const cohort = await prisma.cohort.findUnique({
    where: { id: input.cohortId },
    include: {
      registrations: {
        where,
        orderBy: { createdAt: "asc" },
        include: {
          organization: true,
          participants: true,
          paymentRecords: true,
          webhookEvents: {
            where: { source: "jotform" },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { payload: true }
          }
        }
      }
    }
  });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found."), { code: "NOT_FOUND", status: 404 });
  }

  const mappings = await listActiveJotformFormMappings();
  const fallbackMap = await buildJotformGeographyFallbackMap(input.cohortId, mappings);
  const matchesLocation = (registration: (typeof cohort.registrations)[number]) => {
    const geography = registrationGeography(registration, mappings, fallbackMap);
    const searchableLocation = [geography.city, geography.state, geography.zip].join(" ").toLowerCase();
    const textMatches = cityState ? searchableLocation.includes(cityState.toLowerCase()) : true;
    const cityMatches = city ? geography.city.toLowerCase() === city.toLowerCase() : true;
    const stateMatches = state ? geography.state.toLowerCase() === state.toLowerCase() : true;
    const zipMatches = zip ? geography.zip.toLowerCase() === zip.toLowerCase() : true;
    return textMatches && cityMatches && stateMatches && zipMatches;
  };
  const registrations = cohort.registrations.filter(matchesLocation);
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
      if (cityState || city || state || zip) acc.geographicMatches += 1;
      else {
        const geography = registrationGeography(registration, mappings, fallbackMap);
        if (geography.city || geography.state || geography.zip) acc.geographicMatches += 1;
      }

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
      city: city || "",
      state: state || "",
      zip: zip || "",
      dateFrom: input.dateFrom || "",
      dateTo: input.dateTo || "",
      source: source || "",
      includeArchived: Boolean(input.includeArchived)
    },
    summary,
    registrations: registrations.map((registration) => ({
      id: registration.id,
      organization: registration.organization.name,
      ...registrationGeography(registration, mappings, fallbackMap),
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
