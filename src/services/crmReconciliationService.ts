import { CohortStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncCohortTotalsToCrm } from "@/services/crmRegistrationWebhookService";

const DEFAULT_LIMIT = 10;
const DEFAULT_RECENTLY_COMPLETED_DAYS = 30;

export async function reconcileActiveCohortsToCrm(input: {
  limit?: number;
  recentlyCompletedDays?: number;
} = {}) {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 50);
  const recentlyCompletedDays = Math.min(Math.max(input.recentlyCompletedDays ?? DEFAULT_RECENTLY_COMPLETED_DAYS, 0), 365);
  const completedSince = new Date(Date.now() - recentlyCompletedDays * 24 * 60 * 60 * 1000);

  const cohorts = await prisma.cohort.findMany({
    where: {
      OR: [
        {
          status: {
            in: [
              CohortStatus.PUBLISHED,
              CohortStatus.REGISTRATION_OPEN,
              CohortStatus.REGISTRATION_CLOSED,
              CohortStatus.ACTIVE
            ]
          }
        },
        {
          status: CohortStatus.COMPLETED,
          endDate: { gte: completedSince }
        }
      ]
    },
    orderBy: [{ startDate: "asc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      shortName: true,
      status: true,
      startDate: true,
      endDate: true
    }
  });

  const results = [];

  for (const cohort of cohorts) {
    try {
      const sync = await syncCohortTotalsToCrm(cohort.id, "scheduled.cohort_reconciliation");
      results.push({
        cohort,
        status: sync.status,
        registrations: sync.registrations,
        payloads: sync.payloads,
        sentCount: sync.sentCount,
        failedCount: sync.failedCount
      });
    } catch (error) {
      results.push({
        cohort,
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Unknown CRM cohort reconciliation error"
      });
    }
  }

  const sentCount = results.filter((result) => result.status === "sent").length;
  const partialCount = results.filter((result) => result.status === "partial").length;
  const failedCount = results.filter((result) => result.status === "failed").length;

  return {
    cohortsChecked: cohorts.length,
    sentCount,
    partialCount,
    failedCount,
    results
  };
}
