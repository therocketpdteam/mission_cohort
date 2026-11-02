import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function assertCancellationDeliveryIdle(registrationIds: string[], participantIds: string[], cohortId?: string) {
  const targets = [...registrationIds, ...participantIds, ...(cohortId ? [cohortId] : [])];
  const recipients = [{ registrationId: { in: registrationIds } }, { participantId: { in: participantIds } }, { entityId: { in: targets } }];
  const [emails, jobs, crm] = await Promise.all([
    prisma.cohortCommunication.count({ where: { status: "SENDING", ...(cohortId ? { cohortId } : { OR: [{ registrationId: { in: registrationIds } }, { participantId: { in: participantIds } }] }) } }),
    prisma.integrationSyncJob.count({ where: { entityId: { in: targets }, status: "PROCESSING" } }),
    prisma.crmSyncEvent.count({ where: { OR: recipients, status: "SENDING" } })
  ]);
  if (emails || jobs || crm) throw Object.assign(new Error("Delivery is already in progress. Wait for it to finish before cancelling; a silent cancellation cannot recall messages already sending."), { code: "CANCELLATION_BLOCKED", status: 409 });
}

export async function suppressSilentCancellationDelivery(tx: Prisma.TransactionClient, registrationIds: string[], participantIds: string[], cohortId?: string) {
  const reason = "Suppressed for silent cancellation; customer notifications were handled separately.";
  const targets = [...registrationIds, ...participantIds, ...(cohortId ? [cohortId] : [])];
  await tx.integrationSyncJob.updateMany({
    where: { entityId: { in: targets }, status: { in: ["QUEUED", "FAILED"] } },
    data: { status: "CANCELLED", processedAt: new Date(), errorMessage: reason }
  });
  await tx.crmSyncEvent.updateMany({
    where: { OR: [{ registrationId: { in: registrationIds } }, { participantId: { in: participantIds } }, { entityId: { in: targets } }], status: { in: ["QUEUED", "FAILED"] } },
    data: { status: "REVIEWED", reviewedAt: new Date(), reviewReason: reason }
  });
}
