import { AttendanceStatus, ParticipantStatus, RegistrationStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type CrmRegistrationStatus = "registered" | "attended" | "completed" | "cancelled";

export type CrmRegistrationWebhookPayload = {
  missionCohortId: string;
  missionParticipantId?: string;
  shortName?: string | null;
  cohortName: string;
  startsAt: string;
  endsAt: string;
  productName: "Cohorts";
  thoughtLeaderName?: string | null;
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
};

export type CrmRegistrationRecord = {
  id: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string | null;
  primaryContactTitle?: string | null;
  status: RegistrationStatus;
  createdAt: Date;
  archivedAt?: Date | null;
  cohort: {
    id: string;
    title: string;
    shortName?: string | null;
    startDate: Date;
    endDate: Date;
    presenter?: {
      firstName?: string | null;
      lastName?: string | null;
      shortName?: string | null;
    } | null;
  };
  organization: {
    name: string;
    website?: string | null;
  };
  participants?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    title?: string | null;
    phone?: string | null;
    status: ParticipantStatus;
    attendanceStatus: AttendanceStatus;
  }>;
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

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

export function mapRegistrationToCrmStatus(
  registration: Pick<CrmRegistrationRecord, "status" | "archivedAt">,
  participant?: Pick<NonNullable<CrmRegistrationRecord["participants"]>[number], "status" | "attendanceStatus"> | null
): CrmRegistrationStatus {
  if (registration.archivedAt || registration.status === RegistrationStatus.CANCELLED || participant?.status === ParticipantStatus.CANCELLED) {
    return "cancelled";
  }

  if (registration.status === RegistrationStatus.COMPLETED || participant?.status === ParticipantStatus.COMPLETED) {
    return "completed";
  }

  if (participant?.attendanceStatus === AttendanceStatus.ATTENDED || participant?.attendanceStatus === AttendanceStatus.PARTIAL) {
    return "attended";
  }

  return "registered";
}

export function buildCrmRegistrationWebhookPayload(registration: CrmRegistrationRecord): CrmRegistrationWebhookPayload {
  const contactEmail = registration.primaryContactEmail.trim().toLowerCase();
  const participant = registration.participants?.find((row) => row.email.toLowerCase() === contactEmail);
  const splitName = splitFullName(registration.primaryContactName);
  const firstName = participant?.firstName || splitName.firstName;
  const lastName = participant?.lastName || splitName.lastName;
  const fullName = compactName(firstName, lastName) || registration.primaryContactName.trim() || null;
  const thoughtLeaderName = compactName(registration.cohort.presenter?.firstName, registration.cohort.presenter?.lastName);

  return {
    missionCohortId: registration.cohort.id,
    missionParticipantId: registration.id,
    shortName: crmFriendlyCohortShortName(registration.cohort),
    cohortName: registration.cohort.title,
    startsAt: isoDate(registration.cohort.startDate),
    endsAt: isoDate(registration.cohort.endDate),
    productName: "Cohorts",
    thoughtLeaderName,
    participant: {
      email: contactEmail,
      firstName,
      lastName,
      fullName,
      title: participant?.title ?? registration.primaryContactTitle ?? null,
      phone: participant?.phone ?? registration.primaryContactPhone ?? null
    },
    accountName: registration.organization.name,
    accountDomain: domainFromUrl(registration.organization.website) ?? domainFromEmail(contactEmail),
    status: mapRegistrationToCrmStatus(registration, participant),
    registeredAt: isoDate(registration.createdAt)
  };
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

export async function postCrmRegistrationWebhookPayload(
  payload: CrmRegistrationWebhookPayload,
  config: CrmRegistrationWebhookConfig = {}
): Promise<CrmRegistrationSyncResult> {
  const url = config.url ?? env.CRM_REGISTRATION_WEBHOOK_URL;
  const secret = config.secret ?? env.CRM_REGISTRATION_WEBHOOK_SECRET;
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const timeoutMs = config.timeoutMs ?? 10000;
  const retryDelayMs = config.retryDelayMs ?? 500;

  if (!url || !secret) {
    return { status: "skipped", attempts: 0, permanent: true, error: "CRM registration webhook is not configured." };
  }

  let lastError = "Unknown CRM registration webhook error";

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

      if (response.ok) {
        return { status: "sent", attempts: attempt, httpStatus: response.status };
      }

      const responseText = await response.text().catch(() => "");
      lastError = `CRM registration webhook failed with status ${response.status}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`;

      if (response.status < 500) {
        return { status: "failed", attempts: attempt, httpStatus: response.status, permanent: true, error: lastError };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error calling CRM registration webhook";
    }

    if (attempt < maxAttempts) {
      await wait(retryDelayMs * attempt);
    }
  }

  return { status: "failed", attempts: maxAttempts, permanent: false, error: lastError };
}

export async function syncRegistrationToCrmWebhook(registrationId: string, eventType = "registration.updated") {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      cohort: { include: { presenter: true } },
      organization: true,
      participants: true
    }
  });

  if (!registration) {
    console.warn("CRM registration webhook skipped: registration not found", { registrationId, eventType });
    return { status: "skipped" as const, attempts: 0, permanent: true, error: "Registration not found." };
  }

  const payload = buildCrmRegistrationWebhookPayload(registration);
  const result = await postCrmRegistrationWebhookPayload(payload);
  const logContext = {
    registrationId,
    eventType,
    missionCohortId: payload.missionCohortId,
    participantEmail: payload.participant.email,
    status: payload.status,
    attempts: result.attempts,
    httpStatus: result.httpStatus
  };

  if (result.status === "sent") {
    console.info("CRM registration webhook sent", logContext);
  } else if (result.status === "skipped") {
    console.warn("CRM registration webhook skipped", { ...logContext, error: result.error });
  } else {
    console.error("CRM registration webhook failed", { ...logContext, permanent: result.permanent, error: result.error });
  }

  return result;
}
