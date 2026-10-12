import { IntegrationJobStatus, IntegrationJobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planRegistrationJourneys } from "./registrationJourneyService";
import { queueRegistrationToCrmWebhook } from "./crmRegistrationWebhookService";

type DeliveryPayload = {
  stage?: "POC" | "PARTICIPANTS" | "CRM";
  cursor?: number;
  totalParticipants?: number;
  progress?: number;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function ensureRegistrationDeliveryJobType() {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "IntegrationJobType" ADD VALUE IF NOT EXISTS 'REGISTRATION_DELIVERY'`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "CrmSyncEventStatus" ADD VALUE IF NOT EXISTS 'REVIEWED'`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "CrmSyncEvent" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "reviewReason" TEXT`
  );
}

export async function listRegistrationDeliveryJobs(ids: string[]) {
  return prisma.integrationSyncJob.findMany({
    where: { id: { in: ids }, type: IntegrationJobType.REGISTRATION_DELIVERY },
    orderBy: { createdAt: "desc" },
    select: { id: true, entityId: true, status: true, payload: true, result: true, errorMessage: true, createdAt: true, updatedAt: true, processedAt: true }
  });
}

export async function processRegistrationDeliveryJob(id: string) {
  const claimed = await prisma.integrationSyncJob.updateMany({
    where: { id, type: IntegrationJobType.REGISTRATION_DELIVERY, status: IntegrationJobStatus.QUEUED },
    data: { status: IntegrationJobStatus.PROCESSING, attempts: { increment: 1 }, errorMessage: null }
  });
  if (claimed.count === 0) return prisma.integrationSyncJob.findUnique({ where: { id } });

  const job = await prisma.integrationSyncJob.findUniqueOrThrow({ where: { id } });
  const registrationId = job.entityId;
  if (!registrationId) throw new Error("Registration delivery job is missing its registration ID.");
  const payload = (job.payload ?? {}) as DeliveryPayload;
  const stage = payload.stage ?? "POC";

  try {
    if (stage === "POC") {
      const result = await planRegistrationJourneys(registrationId, {
        participantEmails: [],
        syncCalendar: false,
        planMilestones: false
      });
      return prisma.integrationSyncJob.update({
        where: { id },
        data: {
          status: IntegrationJobStatus.QUEUED,
          payload: json({ ...payload, stage: "PARTICIPANTS", cursor: 0, progress: 15 }),
          result: json({ poc: result })
        }
      });
    }

    if (stage === "PARTICIPANTS") {
      const participants = await prisma.participant.findMany({
        where: { registrationId, status: "REGISTERED" },
        orderBy: { createdAt: "asc" },
        select: { email: true }
      });
      const cursor = Math.max(0, Number(payload.cursor ?? 0));
      const batch = participants.slice(cursor, cursor + 5);
      if (batch.length > 0) {
        const result = await planRegistrationJourneys(registrationId, {
          planPocConfirmation: false,
          participantEmails: batch.map((participant) => participant.email),
          participantConfirmationCohortScoped: true,
          participantConfirmationBatchKey: `background:${job.id}`
        });
        const nextCursor = cursor + batch.length;
        const participantProgress = participants.length ? Math.round((nextCursor / participants.length) * 70) : 70;
        return prisma.integrationSyncJob.update({
          where: { id },
          data: {
            status: IntegrationJobStatus.QUEUED,
            payload: json({ ...payload, stage: nextCursor >= participants.length ? "CRM" : "PARTICIPANTS", cursor: nextCursor, totalParticipants: participants.length, progress: 15 + participantProgress }),
            result: json({ participantBatch: result, processedParticipants: nextCursor })
          }
        });
      }

      return prisma.integrationSyncJob.update({
        where: { id },
        data: { status: IntegrationJobStatus.QUEUED, payload: json({ ...payload, stage: "CRM", progress: 90 }) }
      });
    }

    const crm = await queueRegistrationToCrmWebhook(registrationId, "registration.created");
    return prisma.integrationSyncJob.update({
      where: { id },
      data: {
        status: IntegrationJobStatus.COMPLETED,
        payload: json({ ...payload, stage: "CRM", progress: 100 }),
        result: json({ crmStatus: crm.status, crmEvents: crm.results.length }),
        processedAt: new Date()
      }
    });
  } catch (error) {
    return prisma.integrationSyncJob.update({
      where: { id },
      data: {
        status: IntegrationJobStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Registration delivery failed.",
        processedAt: new Date()
      }
    });
  }
}
