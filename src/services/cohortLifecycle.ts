import { CalendarInviteStatus, CohortStatus, CommunicationStatus, OperationsTaskCategory, OperationsTaskStatus, TemplateType } from "@prisma/client";

const requiredSessionTemplateTypes = [
  TemplateType.WEEK_BEFORE_REMINDER,
  TemplateType.DAY_BEFORE_REMINDER,
  TemplateType.HOUR_BEFORE_REMINDER,
  TemplateType.FOLLOW_UP
] as const;

type LifecycleCommunication = {
  scheduledFor?: Date | string | null;
  status?: CommunicationStatus | string | null;
  template?: { type?: TemplateType | string | null } | null;
  updatedAt?: Date | string | null;
};

type LifecycleSession = {
  id?: string | null;
  title?: string | null;
  sessionNumber?: number | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  timezone?: string | null;
  meetingUrl?: string | null;
  updatedAt?: Date | string | null;
  calendarInviteStatus?: CalendarInviteStatus | string | null;
  calendarEvents?: Array<{
    startTime?: Date | string | null;
    endTime?: Date | string | null;
    timezone?: string | null;
    title?: string | null;
    inviteUrl?: string | null;
    updatedAt?: Date | string | null;
  }> | null;
  communications?: LifecycleCommunication[];
};

type LifecycleCohort = {
  status?: CohortStatus | string | null;
  sessions?: LifecycleSession[];
  operationsTasks?: Array<{
    category?: OperationsTaskCategory | string | null;
    registrationId?: string | null;
    sessionId?: string | null;
    status?: OperationsTaskStatus | string | null;
  }> | null;
};

export type CohortReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};

const requiredSessionTemplateLabels: Record<string, string> = {
  [TemplateType.REGISTRATION_CONFIRMATION]: "Confirmation",
  [TemplateType.WEEK_BEFORE_REMINDER]: "Week-before reminder",
  [TemplateType.DAY_BEFORE_REMINDER]: "Day-before reminder",
  [TemplateType.HOUR_BEFORE_REMINDER]: "Hour-before reminder",
  [TemplateType.FOLLOW_UP]: "Follow-up"
};

function validDate(value?: Date | string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function datesDiffer(first?: Date | string | null, second?: Date | string | null, toleranceMs = 5 * 60 * 1000) {
  const firstDate = validDate(first);
  const secondDate = validDate(second);

  if (!firstDate || !secondDate) {
    return Boolean(firstDate || secondDate);
  }

  return Math.abs(firstDate.getTime() - secondDate.getTime()) > toleranceMs;
}

function expectedScheduledFor(type: TemplateType | string, sessionStart?: Date | string | null) {
  const start = validDate(sessionStart);

  if (!start) {
    return null;
  }

  if (type === TemplateType.WEEK_BEFORE_REMINDER) {
    return new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (type === TemplateType.DAY_BEFORE_REMINDER) {
    return new Date(start.getTime() - 24 * 60 * 60 * 1000);
  }

  if (type === TemplateType.HOUR_BEFORE_REMINDER) {
    return new Date(start.getTime() - 60 * 60 * 1000);
  }

  if (type === TemplateType.FOLLOW_UP) {
    return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }

  return null;
}

function getCommunicationForType(session: LifecycleSession, type: TemplateType) {
  const communications = session.communications ?? [];

  return communications.find((communication) => {
    const status = String(communication.status ?? "");
    return communication.template?.type === type && !["CANCELLED", "FAILED"].includes(status);
  });
}

function getSessionEmailReadiness(session: LifecycleSession) {
  const missing: string[] = [];
  const stale: string[] = [];

  for (const type of requiredSessionTemplateTypes) {
    const communication = getCommunicationForType(session, type);

    if (!communication) {
      missing.push(requiredSessionTemplateLabels[type]);
      continue;
    }

    const expected = expectedScheduledFor(type, session.startTime);
    if (communication.status !== CommunicationStatus.SENT && expected && datesDiffer(communication.scheduledFor, expected)) {
      stale.push(requiredSessionTemplateLabels[type]);
    }
  }

  return {
    ready: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    scheduled: requiredSessionTemplateTypes.length - missing.length,
    total: requiredSessionTemplateTypes.length
  };
}

function getSessionCalendarReadiness(session: LifecycleSession) {
  const readyCalendarStatuses: Array<CalendarInviteStatus | string> = [CalendarInviteStatus.CREATED, CalendarInviteStatus.UPDATED];
  const ready = readyCalendarStatuses.includes(session.calendarInviteStatus ?? "");
  const latestEvent = [...(session.calendarEvents ?? [])]
    .sort((a, b) => (validDate(b.updatedAt)?.getTime() ?? 0) - (validDate(a.updatedAt)?.getTime() ?? 0))[0];
  const pendingUpdate = Boolean(latestEvent && session.calendarInviteStatus === CalendarInviteStatus.NOT_CREATED);
  const stale = Boolean(
    latestEvent &&
    (
      pendingUpdate ||
      datesDiffer(latestEvent.startTime, session.startTime) ||
      datesDiffer(latestEvent.endTime, session.endTime) ||
      (latestEvent.timezone && session.timezone && latestEvent.timezone !== session.timezone) ||
      (latestEvent.title && session.title && latestEvent.title !== session.title) ||
      (latestEvent.inviteUrl ?? "") !== (session.meetingUrl ?? "")
    )
  );

  return {
    ready: ready && !stale,
    stale,
    detail: !ready
      ? pendingUpdate ? "Changes pending" : "Invite missing"
      : stale
        ? "Session changed; update invite"
        : "Invite ready"
  };
}

export function getCohortReadiness(cohort: LifecycleCohort) {
  const sessions = cohort.sessions ?? [];
  const openTaskStatuses: Array<OperationsTaskStatus | string> = [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS];
  const publishReadinessTaskCategories: Array<OperationsTaskCategory | string> = [
    OperationsTaskCategory.CALENDAR_INVITE,
    OperationsTaskCategory.REMINDER_EMAILS
  ];
  const openReadinessTasks = (cohort.operationsTasks ?? []).filter((task) =>
    !task.registrationId &&
    openTaskStatuses.includes(task.status ?? "") &&
    publishReadinessTaskCategories.includes(task.category ?? "")
  );
  const sessionDetails = sessions.map((session) => {
    const calendar = getSessionCalendarReadiness(session);
    const emails = getSessionEmailReadiness(session);
    const sessionTasks = openReadinessTasks.filter((task) => task.sessionId === session.id);
    const blockers = [
      ...(!calendar.ready ? [calendar.detail] : []),
      ...(emails.missing.length > 0 ? [`Missing ${emails.missing.join(", ")}`] : []),
      ...(emails.stale.length > 0 ? [`Update ${emails.stale.join(", ")}`] : []),
      ...sessionTasks.map((task) => `${String(task.category ?? "Task").toLowerCase().replaceAll("_", " ")} needs review`)
    ];

    return {
      id: session.id ?? "",
      sessionNumber: session.sessionNumber ?? null,
      title: session.title ?? "Session",
      startTime: session.startTime ?? null,
      timezone: session.timezone ?? null,
      ready: blockers.length === 0,
      calendar,
      emails: {
        ready: emails.ready,
        scheduled: emails.scheduled,
        total: emails.total,
        missing: emails.missing,
        stale: emails.stale,
        detail: emails.ready
          ? `${emails.total}/${emails.total} emails ready`
          : `${emails.scheduled}/${emails.total} emails ready`
      },
      materials: {
        ready: true,
        openTasks: 0,
        detail: "Optional"
      },
      blockers
    };
  });
  const readyCalendarCount = sessionDetails.filter((session) => session.calendar.ready).length;
  const readyCommunicationCount = sessionDetails.filter((session) => session.emails.ready).length;
  const openManualTasks = openReadinessTasks.length;
  const draftCalendarPlansReady = cohort.status === CohortStatus.DRAFT && sessions.every((session) =>
    Boolean(session.title && validDate(session.startTime) && validDate(session.endTime) && session.timezone)
  );
  const calendarReady = sessions.length > 0 && (draftCalendarPlansReady || readyCalendarCount === sessions.length);
  const communicationsReady = sessions.length > 0 && readyCommunicationCount === sessions.length;
  const manualTasksReady = openManualTasks === 0;

  const items: CohortReadinessItem[] = [
    {
      key: "sessions",
      label: "Sessions created",
      ready: sessions.length > 0,
      detail: sessions.length > 0 ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} scheduled` : "Add at least one session"
    },
    {
      key: "calendar",
      label: cohort.status === CohortStatus.DRAFT ? "Calendar plans ready" : "Calendar invites ready",
      ready: calendarReady,
      detail: sessions.length > 0
        ? draftCalendarPlansReady
          ? `${sessions.length}/${sessions.length} session invite plan${sessions.length === 1 ? "" : "s"} ready`
          : `${readyCalendarCount}/${sessions.length} session invite${sessions.length === 1 ? "" : "s"} ready`
        : "Add sessions before preparing invites"
    },
    {
      key: "communications",
      label: "Session emails ready",
      ready: communicationsReady,
      detail: sessions.length > 0
        ? `${readyCommunicationCount}/${sessions.length} session${sessions.length === 1 ? "" : "s"} have required emails`
        : "Add sessions before scheduling emails"
    },
    {
      key: "manual-tasks",
      label: "Manual tasks cleared",
      ready: manualTasksReady,
      detail: manualTasksReady ? "No open readiness tasks" : `${openManualTasks} open manual task${openManualTasks === 1 ? "" : "s"}`
    }
  ];

  return {
    ready: items.every((item) => item.ready),
    items,
    sessionDetails
  };
}

export function deriveCohortStatus(cohort: LifecycleCohort, now = new Date()): CohortStatus {
  if (cohort.status === CohortStatus.CANCELLED || cohort.status === CohortStatus.ARCHIVED) {
    return CohortStatus.CANCELLED;
  }

  if (cohort.status === CohortStatus.DRAFT) {
    return CohortStatus.DRAFT;
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

  return cohort.status === CohortStatus.PUBLISHED || getCohortReadiness(cohort).ready
    ? CohortStatus.PUBLISHED
    : CohortStatus.DRAFT;
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
