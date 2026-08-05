import { CrmSyncEventStatus, Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  crmRegistrationWebhookHeaders,
  isCrmRegistrationWebhookPayload
} from "@/services/crmRegistrationWebhookService";

export async function queueCrmSyncEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  registrationId?: string;
  participantId?: string;
  organizationId?: string;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.crmSyncEvent.create({
    data: {
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      registrationId: input.registrationId,
      participantId: input.participantId,
      organizationId: input.organizationId,
      payload: JSON.parse(JSON.stringify(input.payload))
    }
  });
}

export async function queueRegistrationCrmSync(registrationId: string, eventType = "registration.updated") {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { cohort: true, organization: true, participants: true, paymentRecords: true }
  });

  if (!registration) {
    return null;
  }

  return queueCrmSyncEvent({
    eventType,
    entityType: "Registration",
    entityId: registration.id,
    registrationId: registration.id,
    organizationId: registration.organizationId,
    payload: {
      missionControlId: registration.id,
      cohort: { id: registration.cohort.id, title: registration.cohort.title, slug: registration.cohort.slug },
      organization: { id: registration.organization.id, name: registration.organization.name, type: registration.organization.type },
      primaryContact: {
        name: registration.primaryContactName,
        email: registration.primaryContactEmail,
        phone: registration.primaryContactPhone,
        title: registration.primaryContactTitle
      },
      registration: {
        status: registration.status,
        source: registration.source,
        participantCount: registration.participantCount,
        participantListStatus: registration.participantListStatus,
        paymentStatus: registration.paymentStatus,
        totalAmount: Number(registration.totalAmount)
      }
    }
  });
}

export async function queueParticipantCrmSync(participantId: string, eventType = "participant.updated") {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: { cohort: true, organization: true, registration: true }
  });

  if (!participant) {
    return null;
  }

  return queueCrmSyncEvent({
    eventType,
    entityType: "Participant",
    entityId: participant.id,
    participantId: participant.id,
    registrationId: participant.registrationId,
    organizationId: participant.organizationId,
    payload: {
      missionControlId: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      email: participant.email,
      title: participant.title,
      phone: participant.phone,
      status: participant.status,
      cohort: { id: participant.cohort.id, title: participant.cohort.title, slug: participant.cohort.slug },
      organization: { id: participant.organization.id, name: participant.organization.name },
      registration: { id: participant.registration.id, primaryContactEmail: participant.registration.primaryContactEmail }
    }
  });
}

export async function processCrmSyncEvents(limit = 25) {
  const candidateLimit = Math.min(Math.max(limit * 100, limit), 5000);
  const candidates = await prisma.crmSyncEvent.findMany({
    where: { status: { in: [CrmSyncEventStatus.QUEUED, CrmSyncEventStatus.FAILED] } },
    orderBy: { createdAt: "asc" },
    take: candidateLimit
  });

  const events = candidates
    .map((event) => ({
      event,
      missionPayload: isCrmRegistrationWebhookPayload(event.payload)
    }))
    .sort((a, b) => {
      if (a.missionPayload !== b.missionPayload) {
        return a.missionPayload ? -1 : 1;
      }

      return a.event.createdAt.getTime() - b.event.createdAt.getTime();
    })
    .slice(0, limit)
    .map(({ event }) => event);
  const results = [];

  for (const event of events) {
    const missionPayload = isCrmRegistrationWebhookPayload(event.payload);
    const url = missionPayload
      ? env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL
      : env.CRM_WEBHOOK_URL;
    const secret = missionPayload
      ? env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET
      : env.CRM_WEBHOOK_SECRET;
    const missingConfigMessage = missionPayload
      ? "CRM Mission Cohort webhook is not configured."
      : "CRM webhook is not configured.";

    if (!url || !secret) {
      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: {
          status: CrmSyncEventStatus.FAILED,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: missingConfigMessage
        }
      });
      results.push({ id: event.id, status: "failed", error: missingConfigMessage });
      continue;
    }

    await prisma.crmSyncEvent.update({
      where: { id: event.id },
      data: { status: CrmSyncEventStatus.SENDING, lastAttemptAt: new Date() }
    });

    try {
      const response = missionPayload
        ? await fetch(url, {
            method: "POST",
            headers: crmRegistrationWebhookHeaders(secret, env.CRM_MISSION_COHORT_VERCEL_BYPASS_SECRET),
            body: JSON.stringify(event.payload)
          })
        : await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-mission-control-secret": secret
            },
            body: JSON.stringify({
              eventType: event.eventType,
              entityType: event.entityType,
              entityId: event.entityId,
              payload: event.payload
            })
          });

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(
          `CRM webhook failed with status ${response.status}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`
        );
      }

      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: { status: CrmSyncEventStatus.SENT, sentAt: new Date(), errorMessage: null }
      });
      results.push({ id: event.id, status: "sent" });
    } catch (error) {
      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: {
          status: CrmSyncEventStatus.FAILED,
          attempts: { increment: 1 },
          errorMessage: error instanceof Error ? error.message : "Unknown CRM sync error"
        }
      });
      results.push({ id: event.id, status: "failed", error: error instanceof Error ? error.message : "Unknown CRM sync error" });
    }
  }

  return results;
}

export async function listCrmSyncEvents() {
  return prisma.crmSyncEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

type CrmSyncSummaryRow = {
  shortName: string | null;
  eventType: string;
  status: CrmSyncEventStatus;
  count: number | bigint;
  oldestCreatedAt: Date | null;
  newestCreatedAt: Date | null;
  newestSentAt: Date | null;
};

type CrmSyncUnsentRow = {
  id: string;
  shortName: string | null;
  eventType: string;
  status: CrmSyncEventStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CrmSyncSentSampleRow = {
  id: string;
  shortName: string | null;
  eventType: string;
  status: CrmSyncEventStatus;
  missionCohortId: string | null;
  missionRegistrationId: string | null;
  missionParticipantId: string | null;
  participantEmail: string | null;
  participantName: string | null;
  organizationName: string | null;
  crmStatus: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

type CrmReplayCountRow = {
  shortName: string | null;
  eligibleCount: number | bigint;
};

type CrmReplaySourceRow = {
  id: string;
  registrationId: string | null;
  participantId: string | null;
  organizationId: string | null;
  shortName: string | null;
  participantEmail: string | null;
  payload: Prisma.JsonValue;
};

function shortNameFilter(shortNames: string[]) {
  return shortNames.length > 0
    ? Prisma.sql`AND payload->>'shortName' IN (${Prisma.join(shortNames)})`
    : Prisma.empty;
}

function publicEndpoint(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return {
      origin: url.origin,
      path: url.pathname
    };
  } catch {
    return { origin: "invalid-url", path: "" };
  }
}

function missionCohortCrmTarget() {
  const url = env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL;
  const secret = env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET;

  return {
    configured: Boolean(url && secret),
    urlSource: env.CRM_MISSION_COHORT_WEBHOOK_URL
      ? "CRM_MISSION_COHORT_WEBHOOK_URL"
      : env.CRM_REGISTRATION_WEBHOOK_URL
        ? "CRM_REGISTRATION_WEBHOOK_URL"
        : null,
    secretSource: env.CRM_MISSION_COHORT_WEBHOOK_SECRET
      ? "CRM_MISSION_COHORT_WEBHOOK_SECRET"
      : env.CRM_REGISTRATION_WEBHOOK_SECRET
        ? "CRM_REGISTRATION_WEBHOOK_SECRET"
        : null,
    endpoint: publicEndpoint(url),
    vercelBypassConfigured: Boolean(env.CRM_MISSION_COHORT_VERCEL_BYPASS_SECRET)
  };
}

async function fetchReceiverDiagnostics(shortNames: string[]) {
  const url = env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL;
  const secret = env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET;
  if (!url || !secret || shortNames.length === 0) {
    return null;
  }

  const diagnosticUrl = new URL(url);
  diagnosticUrl.pathname = "/api/debug/mission-cohort-sync";
  diagnosticUrl.search = "";
  diagnosticUrl.searchParams.set("shortNames", shortNames.join(","));

  const response = await fetch(diagnosticUrl, {
    method: "GET",
    headers: crmRegistrationWebhookHeaders(secret, env.CRM_MISSION_COHORT_VERCEL_BYPASS_SECRET)
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: body?.error ?? "CRM receiver diagnostic request failed."
    };
  }

  return body;
}

export async function summarizeCrmSyncEvents(shortNames: string[] = [], includeReceiverDiagnostics = false) {
  const normalizedShortNames = shortNames.map((value) => value.trim()).filter(Boolean);
  const filter = shortNameFilter(normalizedShortNames);
  const [summaryRows, unsentRows, sentSamples, receiverDiagnostics] = await Promise.all([
    prisma.$queryRaw<CrmSyncSummaryRow[]>(Prisma.sql`
      SELECT
        payload->>'shortName' AS "shortName",
        "eventType",
        status,
        COUNT(*) AS count,
        MIN("createdAt") AS "oldestCreatedAt",
        MAX("createdAt") AS "newestCreatedAt",
        MAX("sentAt") AS "newestSentAt"
      FROM "CrmSyncEvent"
      WHERE jsonb_typeof(payload) = 'object'
        AND payload ? 'shortName'
        ${filter}
      GROUP BY payload->>'shortName', "eventType", status
      ORDER BY payload->>'shortName' ASC, "eventType" ASC, status ASC
    `),
    prisma.$queryRaw<CrmSyncUnsentRow[]>(Prisma.sql`
      SELECT
        id,
        payload->>'shortName' AS "shortName",
        "eventType",
        status,
        attempts,
        "errorMessage",
        "createdAt",
        "updatedAt"
      FROM "CrmSyncEvent"
      WHERE jsonb_typeof(payload) = 'object'
        AND payload ? 'shortName'
        AND status <> 'SENT'::"CrmSyncEventStatus"
        ${filter}
      ORDER BY "createdAt" ASC
      LIMIT 100
    `),
    prisma.$queryRaw<CrmSyncSentSampleRow[]>(Prisma.sql`
      SELECT
        id,
        payload->>'shortName' AS "shortName",
        "eventType",
        status,
        payload->>'missionCohortId' AS "missionCohortId",
        payload->>'missionRegistrationId' AS "missionRegistrationId",
        payload->>'missionParticipantId' AS "missionParticipantId",
        payload#>>'{participant,email}' AS "participantEmail",
        trim(concat_ws(' ', payload#>>'{participant,firstName}', payload#>>'{participant,lastName}')) AS "participantName",
        payload#>>'{organization,name}' AS "organizationName",
        payload->>'status' AS "crmStatus",
        "createdAt",
        "sentAt"
      FROM "CrmSyncEvent"
      WHERE jsonb_typeof(payload) = 'object'
        AND payload ? 'shortName'
        AND status = 'SENT'::"CrmSyncEventStatus"
        AND "eventType" = 'historical_import.registration_imported'
        ${filter}
      ORDER BY payload->>'shortName' ASC, "sentAt" DESC NULLS LAST
      LIMIT 50
    `),
    includeReceiverDiagnostics ? fetchReceiverDiagnostics(normalizedShortNames) : Promise.resolve(null)
  ]);

  return {
    target: missionCohortCrmTarget(),
    summary: summaryRows.map((row) => ({
      ...row,
      count: Number(row.count)
    })),
    unsent: unsentRows,
    sentSamples,
    receiverDiagnostics
  };
}

function replayAuditFilter() {
  return Prisma.sql`
    AND NOT EXISTS (
      SELECT 1
      FROM "CrmSyncEvent" replay
      WHERE replay."eventType" = 'historical_import.registration_replayed'
        AND replay."entityType" = 'CrmSyncEvent'
        AND replay."entityId" = "CrmSyncEvent".id
        AND replay.status = 'SENT'::"CrmSyncEventStatus"
    )
  `;
}

export async function replayHistoricalCrmRegistrationEvents(input: {
  shortNames: string[];
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  offset?: number;
}) {
  const shortNames = input.shortNames.map((value) => value.trim()).filter(Boolean);
  const dryRun = input.dryRun !== false;
  const force = input.force === true;
  const requestedLimit = Number(input.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
  const requestedOffset = Number(input.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(Math.floor(requestedOffset), 0) : 0;
  const url = env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL;
  const secret = env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET;

  if (shortNames.length === 0) {
    return {
      dryRun,
      target: missionCohortCrmTarget(),
      error: "At least one cohort short name is required."
    };
  }

  if (!url || !secret) {
    return {
      dryRun,
      target: missionCohortCrmTarget(),
      error: "CRM Mission Cohort webhook is not configured."
    };
  }

  const filter = shortNameFilter(shortNames);
  const auditFilter = force ? Prisma.empty : replayAuditFilter();
  const counts = await prisma.$queryRaw<CrmReplayCountRow[]>(Prisma.sql`
    SELECT
      payload->>'shortName' AS "shortName",
      COUNT(*) AS "eligibleCount"
    FROM "CrmSyncEvent"
    WHERE jsonb_typeof(payload) = 'object'
      AND payload ? 'shortName'
      AND payload ? 'participant'
      AND payload ? 'missionParticipantId'
      AND "eventType" = 'historical_import.registration_imported'
      AND status = 'SENT'::"CrmSyncEventStatus"
      ${filter}
      ${auditFilter}
    GROUP BY payload->>'shortName'
    ORDER BY payload->>'shortName' ASC
  `);
  const summary = counts.map((row) => ({
    shortName: row.shortName,
    eligibleCount: Number(row.eligibleCount)
  }));
  const totalEligible = summary.reduce((total, row) => total + row.eligibleCount, 0);

  if (dryRun) {
    return {
      dryRun: true,
      target: missionCohortCrmTarget(),
      force,
      limit,
      offset,
      totalEligible,
      summary
    };
  }

  const rows = await prisma.$queryRaw<CrmReplaySourceRow[]>(Prisma.sql`
    SELECT
      id,
      "registrationId",
      "participantId",
      "organizationId",
      payload->>'shortName' AS "shortName",
      payload#>>'{participant,email}' AS "participantEmail",
      payload
    FROM "CrmSyncEvent"
    WHERE jsonb_typeof(payload) = 'object'
      AND payload ? 'shortName'
      AND payload ? 'participant'
      AND payload ? 'missionParticipantId'
      AND "eventType" = 'historical_import.registration_imported'
      AND status = 'SENT'::"CrmSyncEventStatus"
      ${filter}
      ${auditFilter}
    ORDER BY payload->>'shortName' ASC, "createdAt" ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const results = [];

  for (const row of rows) {
    if (!isCrmRegistrationWebhookPayload(row.payload)) {
      results.push({
        id: row.id,
        shortName: row.shortName,
        participantEmail: row.participantEmail,
        status: "skipped",
        error: "Stored payload is not a valid Mission Cohort CRM participant payload."
      });
      continue;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: crmRegistrationWebhookHeaders(secret, env.CRM_MISSION_COHORT_VERCEL_BYPASS_SECRET),
        body: JSON.stringify(row.payload)
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || body?.data?.skipped) {
        const responseText = body ? JSON.stringify(body).slice(0, 300) : "";
        throw new Error(
          `CRM replay failed with status ${response.status}${responseText ? `: ${responseText}` : ""}`
        );
      }

      await prisma.crmSyncEvent.create({
        data: {
          eventType: "historical_import.registration_replayed",
          entityType: "CrmSyncEvent",
          entityId: row.id,
          registrationId: row.registrationId,
          participantId: row.participantId,
          organizationId: row.organizationId,
          payload: JSON.parse(JSON.stringify(row.payload)),
          status: CrmSyncEventStatus.SENT,
          attempts: 1,
          lastAttemptAt: new Date(),
          sentAt: new Date()
        }
      });
      results.push({
        id: row.id,
        shortName: row.shortName,
        participantEmail: row.participantEmail,
        status: "replayed"
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown CRM replay error";
      await prisma.crmSyncEvent.create({
        data: {
          eventType: "historical_import.registration_replayed",
          entityType: "CrmSyncEvent",
          entityId: row.id,
          registrationId: row.registrationId,
          participantId: row.participantId,
          organizationId: row.organizationId,
          payload: JSON.parse(JSON.stringify(row.payload)),
          status: CrmSyncEventStatus.FAILED,
          attempts: 1,
          lastAttemptAt: new Date(),
          errorMessage
        }
      }).catch(() => undefined);
      results.push({
        id: row.id,
        shortName: row.shortName,
        participantEmail: row.participantEmail,
        status: "failed",
        error: errorMessage
      });
    }
  }

  const succeeded = results.filter((result) => result.status === "replayed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    dryRun: false,
    target: missionCohortCrmTarget(),
    force,
    limit,
    offset,
    attempted: rows.length,
    succeeded,
    failed,
    skipped,
    totalEligibleBeforeRun: totalEligible,
    remainingEstimate: Math.max(totalEligible - succeeded, 0),
    summary,
    results
  };
}
