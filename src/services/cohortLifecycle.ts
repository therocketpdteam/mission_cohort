import { CalendarInviteStatus, CohortStatus, CommunicationStatus, TemplateType } from "@prisma/client";

const requiredSessionTemplateTypes = [
  TemplateType.REGISTRATION_CONFIRMATION,
  TemplateType.WEEK_BEFORE_REMINDER,
  TemplateType.DAY_BEFORE_REMINDER,
  TemplateType.HOUR_BEFORE_REMINDER,
  TemplateType.FOLLOW_UP
] as const;

type LifecycleCommunication = {
  status?: CommunicationStatus | string | null;
  template?: { type?: TemplateType | string | null } | null;
};

type LifecycleSession = {
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  calendarInviteStatus?: CalendarInviteStatus | string | null;
  communications?: LifecycleCommunication[];
};

type LifecycleCohort = {
  status?: CohortStatus | string | null;
  sessions?: LifecycleSession[];
};

export type CohortReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};

function validDate(value?: Date | string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function sessionHasRequiredCommunications(session: LifecycleSession) {
  const communications = session.communications ?? [];

  return requiredSessionTemplateTypes.every((type) =>
    communications.some((communication) => {
      const status = String(communication.status ?? "");
      return communication.template?.type === type && !["CANCELLED", "FAILED"].includes(status);
    })
  );
}

export function getCohortReadiness(cohort: LifecycleCohort) {
  const sessions = cohort.sessions ?? [];
  const readyCalendarStatuses: Array<CalendarInviteStatus | string> = [CalendarInviteStatus.CREATED, CalendarInviteStatus.UPDATED];
  const calendarReady = sessions.length > 0 && sessions.every((session) => readyCalendarStatuses.includes(session.calendarInviteStatus ?? ""));
  const communicationsReady = sessions.length > 0 && sessions.every(sessionHasRequiredCommunications);

  const items: CohortReadinessItem[] = [
    {
      key: "sessions",
      label: "Sessions created",
      ready: sessions.length > 0,
      detail: sessions.length > 0 ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} scheduled` : "Add at least one session"
    },
    {
      key: "calendar",
      label: "Calendar invites ready",
      ready: calendarReady,
      detail: calendarReady ? "Every session has a calendar invite" : "Create or sync calendar invites for every session"
    },
    {
      key: "communications",
      label: "Session emails ready",
      ready: communicationsReady,
      detail: communicationsReady ? "Required session emails exist" : "Create default session communications for every session"
    }
  ];

  return {
    ready: items.every((item) => item.ready),
    items
  };
}

export function deriveCohortStatus(cohort: LifecycleCohort, now = new Date()): CohortStatus {
  if (cohort.status === CohortStatus.CANCELLED || cohort.status === CohortStatus.ARCHIVED) {
    return CohortStatus.CANCELLED;
  }

  const sessions = [...(cohort.sessions ?? [])]
    .map((session) => ({ ...session, start: validDate(session.startTime), end: validDate(session.endTime) }))
    .filter((session) => session.start && session.end)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  const firstSession = sessions[0];
  const lastSession = sessions.at(-1);

  if (lastSession?.end && now.getTime() > lastSession.end.getTime()) {
    return CohortStatus.COMPLETED;
  }

  if (firstSession?.start && lastSession?.end && now.getTime() >= firstSession.start.getTime() && now.getTime() <= lastSession.end.getTime()) {
    return CohortStatus.ACTIVE;
  }

  return getCohortReadiness(cohort).ready ? CohortStatus.PUBLISHED : CohortStatus.DRAFT;
}

export function withCohortLifecycle<T extends LifecycleCohort>(cohort: T): T & {
  storedStatus: CohortStatus | string | null | undefined;
  operationalStatus: CohortStatus;
  status: CohortStatus;
  readiness: ReturnType<typeof getCohortReadiness>;
} {
  const readiness = getCohortReadiness(cohort);
  const status = deriveCohortStatus(cohort);

  return {
    ...cohort,
    storedStatus: cohort.status,
    operationalStatus: status,
    status,
    readiness
  };
}
