import { AttendanceStatus, CrmSyncEventStatus, ParticipantStatus, Prisma, RegistrationStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type CrmRegistrationStatus =
  | "registered"
  | "attended"
  | "no_show"
  | "recording_sent"
  | "recording_viewed"
  | "completed"
  | "converted"
  | "cancelled"
  | "canceled"
  | "withdrawn"
  | "withdrew";

export type CrmRegistrationWebhookPayload = {
  organizationSlug: "rocketpd";
  missionCohortId: string;
  missionParticipantId: string;
  cohortName: string;
  shortName: string;
  startsAt: string;
  endsAt: string;
  productId: string | null;
  productName: string;
  thoughtLeaderId: string | null;
  thoughtLeaderName: string | null;
  participant: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    title?: string | null;
    phone?: string | null;
  };
  accountName?: string | null;
  accountDomain?: string | null;
  status: CrmRegistrationStatus;
  registeredAt: string;
  occurredAt: string;
  withdrawnAt?: string;
  cancelledAt?: string;
  seatValue: number;
  totalCohortValue: number;
  activeRegistrantCount: number;
  withdrawnCount: number;
};

export type CrmRegistrationRecord = {
  id: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string | null;
  primaryContactTitle?: string | null;
  participantCount: number;
  totalAmount: Prisma.Decimal | number | string;
  status: RegistrationStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
  cohort: {
    id: string;
    title: string;
    shortName?: string | null;
    startDate: Date;
    endDate: Date;
    presenter?: {
      id?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      shortName?: string | null;
    } | null;
  };
  organization: {
    name: string;
    website?: string | null;
  };
  participants?: CrmParticipantRecord[];
};

export type CrmParticipantRecord = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string | null;
  phone?: string | null;
  status: ParticipantStatus;
  attendanceStatus: AttendanceStatus;
};

type CohortTotalsRegistration = {
  status: RegistrationStatus;
  participantCount: number;
  totalAmount: Prisma.Decimal | number | string;
  archivedAt?: Date | null;
  participants?: Array<Pick<CrmParticipantRecord, "status">>;
};

type CrmRegistrationWebhookConfig = {
  url?: string;
  secret?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
};

type CrmRegistrationSyncResult = {
  status: "sent" | "skipped" | "failed";
  attempts: number;
  httpStatus?: number;
  permanent?: boolean;
  error?: string;
};

type RegistrationSyncOptions = {
  eventType?: string;
  participantOverride?: CrmParticipantRecord;
};

const CRM_REGISTRATION_WEBHOOK_URL = "https://rocketpd-sales-os-git-staging-rocket-pd.vercel.app/api/webhooks/mission-cohort/registrations";

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function moneyNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
}

function compactName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].map((value) => value?.trim()).filter(Boolean).join(" ") || null;
}

function splitFullName(value?: string | null) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null
  };
}

function presenterInitials(presenter?: CrmRegistrationRecord["cohort"]["presenter"]) {
  const name = compactName(presenter?.firstName, presenter?.lastName);
  if (!name) {
    return "TL";
  }

  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function seasonForDate(value: Date) {
  const month = value.getUTCMonth();
  if (month <= 1 || month === 11) return "Winter";
  if (month <= 4) return "Spring";
  if (month <= 7) return "Summer";
  return "Fall";
}

export function crmFriendlyCohortShortName(cohort: CrmRegistrationRecord["cohort"]) {
  if (cohort.shortName?.trim()) {
    return cohort.shortName.trim();
  }

  const leader = cohort.presenter?.shortName?.trim() || presenterInitials(cohort.presenter);
  return `${leader} ${seasonForDate(cohort.startDate)} ${cohort.startDate.getUTCFullYear()}`;
}

function domainFromUrl(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function domainFromEmail(value?: string | null) {
  const domain = value?.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function activeSeatCount(registration: CohortTotalsRegistration) {
  if (registration.archivedAt || registration.status === RegistrationStatus.CANCELLED) {
    return 0;
  }

  const activeParticipants = registration.participants?.filter((participant) => participant.status === ParticipantStatus.REGISTERED).length ?? 0;
  return activeParticipants || Math.max(1, Number(registration.participantCount ?? 0));
}

function withdrawnSeatCount(registration: CohortTotalsRegistration) {
  const participantWithdrawals = registration.participants?.filter((participant) => participant.status === ParticipantStatus.CANCELLED).length ?? 0;
  if (participantWithdrawals > 0) {
    return participantWithdrawals;
  }

  if (registration.archivedAt || registration.status === RegistrationStatus.CANCELLED) {
    return Math.max(1, Number(registration.participantCount ?? 0));
  }

  return 0;
}

export function calculateCohortTotals(registrations: CohortTotalsRegistration[]) {
  return registrations.reduce(
    (totals, registration) => {
      const activeSeats = activeSeatCount(registration);
      return {
        totalCohortValue: totals.totalCohortValue + (activeSeats > 0 ? moneyNumber(registration.totalAmount) : 0),
        activeRegistrantCount: totals.activeRegistrantCount + activeSeats,
        withdrawnCount: totals.withdrawnCount + withdrawnSeatCount(registration)
      };
    },
    { totalCohortValue: 0, activeRegistrantCount: 0, withdrawnCount: 0 }
  );
}

export function mapRegistrationToCrmStatus(
  registration: Pick<CrmRegistrationRecord, "status" | "archivedAt">,
  participant?: Pick<CrmParticipantRecord, "status" | "attendanceStatus"> | null
): CrmRegistrationStatus {
  if (registration.archivedAt) {
    return "withdrawn";
  }

  if (registration.status === RegistrationStatus.CANCELLED || participant?.status === ParticipantStatus.CANCELLED) {
    return "cancelled";
  }

  if (registration.status === RegistrationStatus.COMPLETED || participant?.status === ParticipantStatus.COMPLETED) {
    return "completed";
  }

  if (participant?.attendanceStatus === AttendanceStatus.ABSENT) {
    return "no_show";
  }

  if (participant?.attendanceStatus === AttendanceStatus.ATTENDED || participant?.attendanceStatus === AttendanceStatus.PARTIAL) {
    return "attended";
  }

  return "registered";
}

function participantRowsForRegistration(registration: CrmRegistrationRecord, participantOverride?: CrmParticipantRecord) {
  if (participantOverride) {
    return [participantOverride];
  }

  if (registration.participants?.length) {
    return registration.participants;
  }

  const splitName = splitFullName(registration.primaryContactName);
  return [{
    id: registration.id,
    firstName: splitName.firstName || "Participant",
    lastName: splitName.lastName || "-",
    email: registration.primaryContactEmail,
    title: registration.primaryContactTitle,
    phone: registration.primaryContactPhone,
    status: registration.status === RegistrationStatus.CANCELLED ? ParticipantStatus.CANCELLED : ParticipantStatus.REGISTERED,
    attendanceStatus: AttendanceStatus.UNKNOWN
  }];
}

function seatValue(registration: CrmRegistrationRecord) {
  const seats = Math.max(1, Number(registration.participantCount ?? 0), registration.participants?.length ?? 0);
  return moneyNumber(registration.totalAmount) / seats;
}

export function buildCrmRegistrationWebhookPayloads(
  registration: CrmRegistrationRecord,
  totals = calculateCohortTotals([registration]),
  participantOverride?: CrmParticipantRecord
): CrmRegistrationWebhookPayload[] {
  const shortName = crmFriendlyCohortShortName(registration.cohort);
  const thoughtLeaderName = compactName(registration.cohort.presenter?.firstName, registration.cohort.presenter?.lastName);
  const baseStatus = mapRegistrationToCrmStatus(registration);
  const occurredAt = isoDate(registration.updatedAt);

  return participantRowsForRegistration(registration, participantOverride).map((participant) => {
    const email = participant.email.trim().toLowerCase();
    const status = mapRegistrationToCrmStatus(registration, participant);
    const fullName = compactName(participant.firstName, participant.lastName);
    return {
      organizationSlug: "rocketpd",
      missionCohortId: registration.cohort.id,
      missionParticipantId: participant.id,
      cohortName: registration.cohort.title,
      shortName,
      startsAt: isoDate(registration.cohort.startDate),
      endsAt: isoDate(registration.cohort.endDate),
      productId: null,
      productName: registration.cohort.title,
      thoughtLeaderId: registration.cohort.presenter?.id ?? null,
      thoughtLeaderName,
      participant: {
        email,
        firstName: participant.firstName,
        lastName: participant.lastName,
        fullName,
        title: participant.title ?? null,
        phone: participant.phone ?? null
      },
      accountName: registration.organization.name,
      accountDomain: domainFromUrl(registration.organization.website) ?? domainFromEmail(email),
      status,
      registeredAt: isoDate(registration.createdAt),
      occurredAt,
      ...(status === "withdrawn" ? { withdrawnAt: isoDate(registration.archivedAt ?? registration.updatedAt) } : {}),
      ...(status === "cancelled" ? { cancelledAt: occurredAt } : {}),
      ...(baseStatus === "withdrawn" && status !== "withdrawn" ? { withdrawnAt: isoDate(registration.archivedAt ?? registration.updatedAt) } : {}),
      seatValue: seatValue(registration),
      totalCohortValue: totals.totalCohortValue,
      activeRegistrantCount: totals.activeRegistrantCount,
      withdrawnCount: totals.withdrawnCount
    };
  });
}

export function buildCrmRegistrationWebhookPayload(registration: CrmRegistrationRecord): CrmRegistrationWebhookPayload {
  return buildCrmRegistrationWebhookPayloads(registration)[0]!;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function crmWebhookUrl(config: CrmRegistrationWebhookConfig) {
  return config.url ?? env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL ?? CRM_REGISTRATION_WEBHOOK_URL;
}

function crmWebhookSecret(config: CrmRegistrationWebhookConfig) {
  return config.secret ?? env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET;
}

async function createSyncEvent(payload: CrmRegistrationWebhookPayload, eventType: string, registrationId?: string) {
  return prisma.crmSyncEvent.create({
    data: {
      eventType,
      entityType: "Registration",
      entityId: payload.missionParticipantId,
      registrationId,
      payload: JSON.parse(JSON.stringify(payload)),
      status: CrmSyncEventStatus.SENDING,
      attempts: 1,
      lastAttemptAt: new Date()
    }
  });
}

async function updateSyncEvent(
  eventId: string | undefined,
  data: { status: CrmSyncEventStatus; attempts?: number; errorMessage?: string | null }
) {
  if (!eventId) {
    return;
  }

  await prisma.crmSyncEvent.update({
    where: { id: eventId },
    data: {
      status: data.status,
      attempts: data.attempts,
      sentAt: data.status === CrmSyncEventStatus.SENT ? new Date() : undefined,
      errorMessage: data.errorMessage ?? null
    }
  }).catch(() => undefined);
}

export async function postCrmRegistrationWebhookPayload(
  payload: CrmRegistrationWebhookPayload,
  config: CrmRegistrationWebhookConfig & { eventType?: string; registrationId?: string } = {}
): Promise<CrmRegistrationSyncResult> {
  const url = crmWebhookUrl(config);
  const secret = crmWebhookSecret(config);
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const timeoutMs = config.timeoutMs ?? 10000;
  const retryDelayMs = config.retryDelayMs ?? 500;
  let syncEventId: string | undefined;

  if (!url || !secret) {
    return { status: "skipped", attempts: 0, permanent: true, error: "CRM Mission Cohort webhook is not configured." };
  }

  const syncEvent = await createSyncEvent(payload, config.eventType ?? "registration.updated", config.registrationId).catch(() => null);
  syncEventId = syncEvent?.id;

  let lastError = "Unknown CRM Mission Cohort webhook error";
  let lastHttpStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }, timeoutMs);
      lastHttpStatus = response.status;

      if (response.ok) {
        await updateSyncEvent(syncEventId, { status: CrmSyncEventStatus.SENT, attempts: attempt });
        return { status: "sent", attempts: attempt, httpStatus: response.status };
      }

      const responseText = await response.text().catch(() => "");
      lastError = `CRM Mission Cohort webhook failed with status ${response.status}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`;

      if (response.status < 500) {
        await updateSyncEvent(syncEventId, { status: CrmSyncEventStatus.FAILED, attempts: attempt, errorMessage: lastError });
        return { status: "failed", attempts: attempt, httpStatus: response.status, permanent: true, error: lastError };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error calling CRM Mission Cohort webhook";
    }

    if (attempt < maxAttempts) {
      await wait(retryDelayMs * attempt);
    }
  }

  await updateSyncEvent(syncEventId, { status: CrmSyncEventStatus.FAILED, attempts: maxAttempts, errorMessage: lastError });
  return { status: "failed", attempts: maxAttempts, permanent: false, httpStatus: lastHttpStatus, error: lastError };
}

async function cohortRegistrations(cohortId: string) {
  return prisma.registration.findMany({
    where: { cohortId },
    include: { participants: true }
  });
}

async function registrationForCrm(registrationId: string) {
  return prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      participants: true
    }
  });
}

async function postPayloads(payloads: CrmRegistrationWebhookPayload[], registrationId: string, eventType: string) {
  const results = [];
  for (const payload of payloads) {
    const result = await postCrmRegistrationWebhookPayload(payload, { eventType, registrationId });
    const logContext = {
      registrationId,
      eventType,
      missionCohortId: payload.missionCohortId,
      missionParticipantId: payload.missionParticipantId,
      participantEmail: payload.participant.email,
      status: payload.status,
      attempts: result.attempts,
      httpStatus: result.httpStatus
    };

    if (result.status === "sent") {
      console.info("CRM Mission Cohort webhook sent", logContext);
    } else if (result.status === "skipped") {
      console.warn("CRM Mission Cohort webhook skipped", { ...logContext, error: result.error });
    } else {
      console.error("CRM Mission Cohort webhook failed", { ...logContext, permanent: result.permanent, error: result.error });
    }
    results.push({ payload, result });
  }

  return results;
}

export async function syncRegistrationToCrm(registrationId: string, options: RegistrationSyncOptions = {}) {
  const registration = await registrationForCrm(registrationId);

  if (!registration) {
    console.warn("CRM Mission Cohort webhook skipped: registration not found", { registrationId, eventType: options.eventType });
    return { status: "skipped" as const, results: [], error: "Registration not found." };
  }

  const totals = calculateCohortTotals(await cohortRegistrations(registration.cohortId));
  const payloads = buildCrmRegistrationWebhookPayloads(registration, totals, options.participantOverride);
  const results = await postPayloads(payloads, registration.id, options.eventType ?? "registration.updated");
  return { status: results.every((item) => item.result.status === "sent") ? "sent" as const : "partial" as const, results };
}

export async function syncRegistrationToCrmWebhook(registrationId: string, eventType = "registration.updated") {
  return syncRegistrationToCrm(registrationId, { eventType });
}

export async function syncCohortTotalsToCrm(cohortId: string, eventType = "cohort.totals_updated") {
  const registrations = await prisma.registration.findMany({
    where: { cohortId },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      participants: true
    },
    orderBy: { createdAt: "asc" }
  });
  const totals = calculateCohortTotals(registrations);
  const results = [];

  for (const registration of registrations) {
    const payloads = buildCrmRegistrationWebhookPayloads(registration, totals);
    results.push(...await postPayloads(payloads, registration.id, eventType));
  }

  return { cohortId, registrations: registrations.length, payloads: results.length, results };
}

export async function syncRemovedParticipantToCrm(participant: CrmParticipantRecord & { registrationId: string }) {
  return syncRegistrationToCrm(participant.registrationId, {
    eventType: "participant.removed",
    participantOverride: { ...participant, status: ParticipantStatus.CANCELLED }
  });
}
