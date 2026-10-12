import { IntegrationJobStatus, IntegrationJobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processScheduledCommunications } from "@/services/communicationService";
import { processCrmSyncEvents } from "@/services/crmSyncService";
import { markIntegrationJobCompleted, markIntegrationJobFailed } from "@/services/integrationService";
import { syncQuickBooksInvoice, voidRegistrationQuickBooksInvoice } from "@/services/quickBooksService";
import { processRegistrationDeliveryJob } from "@/services/registrationDeliveryJobService";

export async function processIntegrationJobs(limit = 25) {
  const registrationJobs = await prisma.integrationSyncJob.findMany({
    where: {
      type: IntegrationJobType.REGISTRATION_DELIVERY,
      status: IntegrationJobStatus.QUEUED,
      runAfter: { lte: new Date() }
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 5),
    select: { id: true }
  });
  const registrationResults = [];
  for (const job of registrationJobs) {
    registrationResults.push(await processRegistrationDeliveryJob(job.id));
  }

  const jobs = await prisma.integrationSyncJob.findMany({
    where: {
      type: { not: IntegrationJobType.REGISTRATION_DELIVERY },
      status: IntegrationJobStatus.QUEUED,
      runAfter: { lte: new Date() }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });
  const results = [];

  for (const job of jobs) {
    await prisma.integrationSyncJob.update({
      where: { id: job.id },
      data: { status: IntegrationJobStatus.PROCESSING, attempts: { increment: 1 } }
    });

    try {
      let result: unknown = { status: "noop" };

      if (job.type === IntegrationJobType.QUICKBOOKS_SYNC && job.entityId) {
        result = await syncQuickBooksInvoice(job.entityId);
      }

      if (job.type === IntegrationJobType.QUICKBOOKS_VOID_INVOICE && job.entityId) {
        result = await voidRegistrationQuickBooksInvoice(job.entityId);
      }

      if (job.type === IntegrationJobType.CRM_PUSH) {
        result = await processCrmSyncEvents(10);
      }

      await markIntegrationJobCompleted(job.id, result);
      results.push({ id: job.id, status: "completed", result });
    } catch (error) {
      await markIntegrationJobFailed(job.id, error);
      results.push({ id: job.id, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return [...registrationResults, ...results];
}

export async function processAllIntegrationWork() {
  const [jobs, scheduledCommunications, crm] = await Promise.all([
    processIntegrationJobs(),
    processScheduledCommunications(),
    processCrmSyncEvents()
  ]);

  return { jobs, scheduledCommunications, crm };
}
