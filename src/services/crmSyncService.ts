import { CrmSyncEventStatus, Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { assertOutboundUnlocked } from "@/lib/outboundLock";
import { prisma } from "@/lib/prisma";
import {
  crmRegistrationWebhookHeaders,
  isCrmRegistrationWebhookPayload,
  queueRegistrationToCrmWebhook
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

export async function processCrmSyncEvents(
  limit = 25,
  options: { shortNames?: string[]; eventTypes?: string[]; retryFailed?: boolean } = {}
) {
  const staleSendingBefore = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.crmSyncEvent.updateMany({
    where: {
      status: CrmSyncEventStatus.SENDING,
      updatedAt: { lt: staleSendingBefore }
    },
    data: {
      status: CrmSyncEventStatus.FAILED,
      errorMessage: "Recovered after the previous CRM worker stopped before recording a result."
    }
  });

  const shortNameSet = new Set(options.shortNames?.map((value) => value.trim()).filter(Boolean));
  const eventTypeSet = new Set(options.eventTypes?.map((value) => value.trim()).filter(Boolean));
  const candidateLimit = Math.min(Math.max(limit * 100, limit), 5000);
  const candidates = await prisma.crmSyncEvent.findMany({
    where: {
      status: options.retryFailed === true
        ? { in: [CrmSyncEventStatus.QUEUED, CrmSyncEventStatus.FAILED] }
        : CrmSyncEventStatus.QUEUED,
      ...(eventTypeSet.size ? { eventType: { in: Array.from(eventTypeSet) } } : {})
    },
    orderBy: { createdAt: "asc" },
    take: candidateLimit
  });

  const events = candidates
    .filter((event) => {
      if (shortNameSet.size === 0) {
        return true;
      }

      const payload = event.payload;
      return Boolean(
        payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          shortNameSet.has(String((payload as { shortName?: unknown }).shortName ?? "").trim())
      );
    })
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

    await assertOutboundUnlocked({
      channel: "CRM",
      action: "process CRM sync event",
      entityType: "CrmSyncEvent",
      entityId: event.id,
      metadata: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        missionPayload
      }
    });

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

type CrmBacklogAuditRow = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  registrationId: string | null;
  participantId: string | null;
  status: CrmSyncEventStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  invoiceNumber: string | null;
  registrationStatus: string | null;
  registrationUpdatedAt: Date | null;
  participantEmail: string | null;
  participantStatus: string | null;
  participantUpdatedAt: Date | null;
  hasNewerEvent: boolean;
  hasNewerSentEvent: boolean;
};

export async function auditCrmSyncBacklog() {
  const rows = await prisma.$queryRaw<CrmBacklogAuditRow[]>(Prisma.sql`
    SELECT
      event.id,
      event."eventType",
      event."entityType",
      event."entityId",
      event."registrationId",
      event."participantId",
      event.status,
      event.attempts,
      event."errorMessage",
      event."createdAt",
      event."updatedAt",
      registration."invoiceNumber",
      registration.status::text AS "registrationStatus",
      registration."updatedAt" AS "registrationUpdatedAt",
      participant.email AS "participantEmail",
      participant.status::text AS "participantStatus",
      participant."updatedAt" AS "participantUpdatedAt",
      EXISTS (
        SELECT 1 FROM "CrmSyncEvent" newer
        WHERE newer."entityType" = event."entityType"
          AND newer."entityId" = event."entityId"
          AND newer."createdAt" > event."createdAt"
      ) AS "hasNewerEvent",
      EXISTS (
        SELECT 1 FROM "CrmSyncEvent" newer
        WHERE newer."entityType" = event."entityType"
          AND newer."entityId" = event."entityId"
          AND newer.status = 'SENT'::"CrmSyncEventStatus"
          AND newer."createdAt" > event."createdAt"
      ) AS "hasNewerSentEvent"
    FROM "CrmSyncEvent" event
    LEFT JOIN "Registration" registration ON registration.id = event."registrationId"
    LEFT JOIN "Participant" participant ON participant.id = event."participantId"
    WHERE event.status NOT IN ('SENT'::"CrmSyncEventStatus", 'REVIEWED'::"CrmSyncEventStatus")
    ORDER BY event."createdAt" ASC
    LIMIT 2000
  `);

  const audited = rows.map((row) => {
    const entityMissing = row.entityType === "Registration"
      ? !row.registrationId || !row.registrationStatus
      : row.entityType === "Participant"
        ? !row.participantId || !row.participantStatus
        : false;
    const category = entityMissing
      ? "missing_entity"
      : row.hasNewerSentEvent
        ? "superseded_by_sent"
        : row.hasNewerEvent
          ? "superseded_by_newer"
          : row.status === CrmSyncEventStatus.SENDING
            ? "stalled_current"
            : row.status === CrmSyncEventStatus.FAILED
              ? "failed_current"
              : "queued_current";
    return { ...row, category };
  });
  const countBy = (key: "category" | "status" | "eventType") => Object.fromEntries(
    Array.from(audited.reduce((counts, row) => counts.set(String(row[key]), (counts.get(String(row[key])) ?? 0) + 1), new Map<string, number>()).entries()).sort()
  );

  return {
    total: audited.length,
    byCategory: countBy("category"),
    byStatus: countBy("status"),
    byEventType: countBy("eventType"),
    rows: audited
  };
}

const LEGACY_CRM_SNAPSHOT_EVENT_TYPES = ["registration.snapshot", "participant.snapshot"] as const;
const CRM_CURRENT_SNAPSHOT_EVENT_TYPE = "registration.current_snapshot";

async function ensureCrmReviewSchema() {
  await prisma.$executeRawUnsafe(`ALTER TYPE "CrmSyncEventStatus" ADD VALUE IF NOT EXISTS 'REVIEWED'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CrmSyncEvent" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CrmSyncEvent" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT`);
}

type CrmRecoveryRegistrationRow = { registrationId: string };

export async function prepareCrmBacklogRecovery(options: { dryRun?: boolean; limit?: number } = {}) {
  await ensureCrmReviewSchema();
  const dryRun = options.dryRun !== false;
  const requestedLimit = Math.max(1, Math.min(Number(options.limit ?? 5), 10));
  const missingRows = await prisma.$queryRaw<CrmRecoveryRegistrationRow[]>(Prisma.sql`
    SELECT DISTINCT legacy."registrationId"
    FROM "CrmSyncEvent" legacy
    WHERE legacy."eventType" IN ('registration.snapshot', 'participant.snapshot')
      AND legacy.status IN ('QUEUED'::"CrmSyncEventStatus", 'FAILED'::"CrmSyncEventStatus", 'SENDING'::"CrmSyncEventStatus")
      AND legacy."registrationId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "CrmSyncEvent" replacement
        WHERE replacement."registrationId" = legacy."registrationId"
          AND replacement."eventType" = ${CRM_CURRENT_SNAPSHOT_EVENT_TYPE}
          AND replacement.status <> 'REVIEWED'::"CrmSyncEventStatus"
      )
    ORDER BY legacy."registrationId"
    LIMIT ${dryRun ? 1000 : requestedLimit}
  `);
  const registrationIds = missingRows.map((row) => row.registrationId);

  if (dryRun) {
    return {
      dryRun: true,
      remainingRegistrations: registrationIds.length,
      nextBatchSize: Math.min(requestedLimit, registrationIds.length),
      snapshotEventTypes: [CRM_CURRENT_SNAPSHOT_EVENT_TYPE]
    };
  }

  let queuedMissionPayloads = 0;
  for (const registrationId of registrationIds) {
    const result = await queueRegistrationToCrmWebhook(registrationId, CRM_CURRENT_SNAPSHOT_EVENT_TYPE);
    queuedMissionPayloads += result.results.length;
  }

  const remainingRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT legacy."registrationId") AS count
    FROM "CrmSyncEvent" legacy
    WHERE legacy."eventType" IN ('registration.snapshot', 'participant.snapshot')
      AND legacy.status IN ('QUEUED'::"CrmSyncEventStatus", 'FAILED'::"CrmSyncEventStatus", 'SENDING'::"CrmSyncEventStatus")
      AND legacy."registrationId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "CrmSyncEvent" replacement
        WHERE replacement."registrationId" = legacy."registrationId"
          AND replacement."eventType" = ${CRM_CURRENT_SNAPSHOT_EVENT_TYPE}
          AND replacement.status <> 'REVIEWED'::"CrmSyncEventStatus"
      )
  `);
  const remainingRegistrations = Number(remainingRows[0]?.count ?? 0);

  let reviewedLegacySnapshots = 0;
  if (remainingRegistrations === 0) {
    const reviewed = await prisma.crmSyncEvent.updateMany({
      where: {
        eventType: { in: [...LEGACY_CRM_SNAPSHOT_EVENT_TYPES] },
        status: { in: [CrmSyncEventStatus.QUEUED, CrmSyncEventStatus.FAILED, CrmSyncEventStatus.SENDING] }
      },
      data: {
        status: CrmSyncEventStatus.REVIEWED,
        reviewedAt: new Date(),
        reviewReason: "replaced_by_mission_snapshot",
        errorMessage: null
      }
    });
    reviewedLegacySnapshots = reviewed.count;
  }

  return {
    dryRun: false,
    processedRegistrations: registrationIds.length,
    queuedMissionPayloads,
    remainingRegistrations,
    reviewedLegacySnapshots,
    snapshotEventTypes: [CRM_CURRENT_SNAPSHOT_EVENT_TYPE]
  };
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

  await assertOutboundUnlocked({
    channel: "CRM",
    action: "fetch CRM receiver diagnostics",
    metadata: { shortNames }
  });

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
  // Production uses a single-connection transaction pool. Keep these diagnostics
  // sequential so the read-only report cannot exhaust its own function pool.
  const summaryRows = await prisma.$queryRaw<CrmSyncSummaryRow[]>(Prisma.sql`
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
    `);
  const unsentRows = await prisma.$queryRaw<CrmSyncUnsentRow[]>(Prisma.sql`
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
    `);
  const sentSamples = await prisma.$queryRaw<CrmSyncSentSampleRow[]>(Prisma.sql`
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
    `);
  const receiverDiagnostics = includeReceiverDiagnostics
    ? await fetchReceiverDiagnostics(normalizedShortNames)
    : null;

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
      await assertOutboundUnlocked({
        channel: "CRM",
        action: "replay CRM historical import event",
        entityType: "CrmSyncEvent",
        entityId: row.id,
        metadata: {
          shortName: row.shortName,
          participantEmail: row.participantEmail
        }
      });
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
