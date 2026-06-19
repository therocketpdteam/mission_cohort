import {
  CalendarInviteStatus,
  CommunicationStatus,
  OperationsTaskCategory,
  OperationsTaskStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

const resettableCommunicationStatuses = [
  CommunicationStatus.DRAFT,
  CommunicationStatus.SCHEDULED,
  CommunicationStatus.SENDING,
  CommunicationStatus.FAILED
];

export async function getOutboundAutomationAudit() {
  const [cohorts, communications, calendarEvents] = await Promise.all([
    prisma.cohort.findMany({
      orderBy: { title: "asc" },
      select: { id: true, title: true }
    }),
    prisma.cohortCommunication.groupBy({
      by: ["cohortId", "status"],
      _count: { _all: true }
    }),
    prisma.calendarEvent.groupBy({
      by: ["cohortId", "provider"],
      _count: { _all: true }
    })
  ]);

  return cohorts.map((cohort) => ({
    ...cohort,
    communications: communications
      .filter((row) => row.cohortId === cohort.id)
      .reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.status]: row._count._all }), {}),
    calendarEvents: calendarEvents
      .filter((row) => row.cohortId === cohort.id)
      .reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.provider]: row._count._all }), {})
  }));
}

export async function resetUnsentCohortAutomation(input: { excludeCohortId?: string | null }) {
  const cohorts = await prisma.cohort.findMany({
    where: input.excludeCohortId ? { id: { not: input.excludeCohortId } } : undefined,
    select: { id: true }
  });
  const cohortIds = cohorts.map((cohort) => cohort.id);

  if (cohortIds.length === 0) {
    return { cohortsReset: 0, communicationsCancelled: 0, icsEventsCleared: 0, sessionsReset: 0, tasksReopened: 0, googleEventsPreserved: 0 };
  }

  const googleEventsPreserved = await prisma.calendarEvent.count({
    where: { cohortId: { in: cohortIds }, provider: "google" }
  });

  const [communications, icsEvents, sessions, tasks] = await prisma.$transaction([
    prisma.cohortCommunication.updateMany({
      where: {
        cohortId: { in: cohortIds },
        status: { in: resettableCommunicationStatuses }
      },
      data: {
        status: CommunicationStatus.CANCELLED,
        scheduledFor: null,
        providerError: "Cancelled during outbound safety reset before live delivery."
      }
    }),
    prisma.calendarEvent.deleteMany({
      where: { cohortId: { in: cohortIds }, provider: "ics" }
    }),
    prisma.cohortSession.updateMany({
      where: {
        cohortId: { in: cohortIds },
        calendarEvents: { none: { provider: "google" } }
      },
      data: { calendarInviteStatus: CalendarInviteStatus.NOT_CREATED }
    }),
    prisma.operationsTask.updateMany({
      where: {
        category: { in: [OperationsTaskCategory.CALENDAR_INVITE, OperationsTaskCategory.REMINDER_EMAILS] },
        OR: [
          { cohortId: { in: cohortIds } },
          { session: { cohortId: { in: cohortIds } } }
        ]
      },
      data: { status: OperationsTaskStatus.OPEN, completedAt: null }
    })
  ]);

  return {
    cohortsReset: cohortIds.length,
    communicationsCancelled: communications.count,
    icsEventsCleared: icsEvents.count,
    sessionsReset: sessions.count,
    tasksReopened: tasks.count,
    googleEventsPreserved
  };
}
