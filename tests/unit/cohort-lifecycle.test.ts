import assert from "node:assert/strict";
import test from "node:test";
import {
  CalendarInviteStatus,
  CohortStatus,
  CommunicationStatus,
  OperationsTaskCategory,
  OperationsTaskStatus,
  TemplateType
} from "@prisma/client";
import { deriveCohortStatus, getCohortReadiness, withCohortLifecycle } from "../../src/services/cohortLifecycle";

const sessionStart = new Date("2026-07-10T14:00:00.000Z");
const readyPrepResources = {
  description: "A cohort description.",
  guideTopic: "Instructional design",
  guideUrl: "https://rocketpd.com/guide",
  podcastUrl: "https://youtu.be/example"
};

function communication(type: TemplateType, scheduledFor: Date, status: CommunicationStatus = CommunicationStatus.SCHEDULED) {
  return { template: { type }, scheduledFor, status };
}

test("treats complete draft session plans as publish-ready before provider delivery", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.NOT_CREATED,
      communications: [
        communication(TemplateType.WEEK_BEFORE_REMINDER, new Date(sessionStart.getTime() - 7 * 24 * 60 * 60 * 1000)),
        communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
        communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
        communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
      ]
    }]
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.items.find((item) => item.key === "calendar")?.label, "Calendar plans ready");
  assert.equal(readiness.items.find((item) => item.key === "prep-resources")?.ready, true);
  assert.equal(readiness.items.find((item) => item.key === "meeting-links")?.ready, true);
  assert.equal(readiness.sessionDetails[0]?.emails.total, 4);
});

test("treats draft session email plans as system-ready before concrete schedules exist", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.NOT_CREATED,
      communications: []
    }]
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.items.find((item) => item.key === "communications")?.label, "Session email plan ready");
  assert.equal(readiness.items.find((item) => item.key === "communications")?.detail, "1/1 session email plan ready");
});

test("shows draft plan readiness after an active cohort falls back to draft operationally", () => {
  const futureSessionStart = new Date("2099-07-10T14:00:00.000Z");
  const cohort = withCohortLifecycle({
    status: CohortStatus.ACTIVE,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: futureSessionStart,
      endTime: new Date(futureSessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.NOT_CREATED,
      calendarEvents: [],
      communications: [
        communication(TemplateType.WEEK_BEFORE_REMINDER, futureSessionStart, CommunicationStatus.CANCELLED),
        communication(TemplateType.DAY_BEFORE_REMINDER, futureSessionStart, CommunicationStatus.CANCELLED),
        communication(TemplateType.HOUR_BEFORE_REMINDER, futureSessionStart, CommunicationStatus.CANCELLED),
        communication(TemplateType.FOLLOW_UP, futureSessionStart, CommunicationStatus.CANCELLED)
      ]
    }],
    operationsTasks: [
      {
        category: OperationsTaskCategory.CALENDAR_INVITE,
        status: OperationsTaskStatus.OPEN
      },
      {
        category: OperationsTaskCategory.REMINDER_EMAILS,
        status: OperationsTaskStatus.IN_PROGRESS
      }
    ]
  });

  assert.equal(cohort.storedStatus, CohortStatus.ACTIVE);
  assert.equal(cohort.status, CohortStatus.DRAFT);
  assert.equal(cohort.readiness.items.find((item) => item.key === "calendar")?.label, "Calendar plans ready");
  assert.equal(cohort.readiness.items.find((item) => item.key === "calendar")?.ready, true);
  assert.equal(cohort.readiness.items.find((item) => item.key === "communications")?.label, "Session email plan ready");
  assert.equal(cohort.readiness.items.find((item) => item.key === "communications")?.ready, true);
  assert.equal(cohort.readiness.items.find((item) => item.key === "manual-tasks")?.ready, true);
  assert.equal(cohort.readiness.sessionDetails[0]?.calendar.detail, "Invite will be created on publish");
  assert.equal(cohort.readiness.sessionDetails[0]?.emails.detail, "4/4 email plans ready");
});

test("does not require one-week session reminders after the first session", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.PUBLISHED,
    ...readyPrepResources,
    sessions: [{
      id: "session-2",
      sessionNumber: 2,
      title: "Session 2",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.CREATED,
      calendarEvents: [{
        provider: "google",
        providerEventId: "google-session-2",
        title: "Session 2",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York",
        inviteUrl: "https://zoom.us/j/123456789"
      }],
      communications: [
        communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
        communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
        communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
      ]
    }]
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.sessionDetails[0]?.emails.total, 3);
  assert.deepEqual(readiness.sessionDetails[0]?.emails.missing, []);
});

test("keeps session email readiness when delivery issues are tracked on communication records", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.PUBLISHED,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      sessionNumber: 1,
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.CREATED,
      calendarEvents: [{
        provider: "google",
        providerEventId: "google-session-1",
        title: "Session 1",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York",
        inviteUrl: "https://zoom.us/j/123456789"
      }],
      communications: [
        communication(TemplateType.WEEK_BEFORE_REMINDER, new Date(sessionStart.getTime() - 7 * 24 * 60 * 60 * 1000), CommunicationStatus.FAILED),
        communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
        communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
        communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
      ]
    }]
  });

  assert.equal(readiness.items.find((item) => item.key === "communications")?.ready, true);
  assert.equal(readiness.sessionDetails[0]?.emails.detail, "4/4 emails ready");
});

test("requires every published session to have a Google invite once Google is in use", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.PUBLISHED,
    ...readyPrepResources,
    sessions: [
      {
        id: "session-1",
        sessionNumber: 1,
        title: "Session 1",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York",
        meetingUrl: "https://zoom.us/j/123456789",
        calendarInviteStatus: CalendarInviteStatus.CREATED,
        calendarEvents: [{
          provider: "google",
          providerEventId: "google-session-1",
          title: "Session 1",
          startTime: sessionStart,
          endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
          timezone: "America/New_York",
          inviteUrl: "https://zoom.us/j/123456789"
        }],
        communications: [
          communication(TemplateType.WEEK_BEFORE_REMINDER, new Date(sessionStart.getTime() - 7 * 24 * 60 * 60 * 1000)),
          communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
          communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
          communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
        ]
      },
      {
        id: "session-2",
        sessionNumber: 2,
        title: "Session 2",
        startTime: new Date(sessionStart.getTime() + 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(sessionStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        timezone: "America/New_York",
        meetingUrl: "https://zoom.us/j/123456789",
        calendarInviteStatus: CalendarInviteStatus.CREATED,
        calendarEvents: [{
          provider: "ics",
          title: "Session 2",
          startTime: new Date(sessionStart.getTime() + 7 * 24 * 60 * 60 * 1000),
          endTime: new Date(sessionStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
          timezone: "America/New_York",
          inviteUrl: "https://zoom.us/j/123456789"
        }],
        communications: [
          communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() + 6 * 24 * 60 * 60 * 1000)),
          communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)),
          communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 8 * 24 * 60 * 60 * 1000))
        ]
      }
    ]
  });

  assert.equal(readiness.items.find((item) => item.key === "calendar")?.ready, false);
  assert.equal(readiness.items.find((item) => item.key === "calendar")?.detail, "1/2 session invites ready");
  assert.equal(readiness.sessionDetails[1]?.calendar.detail, "Google invite missing");
});

test("keeps published calendar readiness when attendee sync fails after the Google event exists", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.PUBLISHED,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      sessionNumber: 1,
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.FAILED,
      calendarEvents: [{
        provider: "google",
        providerEventId: "google-session-1",
        title: "Session 1",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York",
        inviteUrl: "https://zoom.us/j/123456789",
        updatedAt: new Date("2026-07-01T00:00:00.000Z")
      }],
      communications: [
        communication(TemplateType.WEEK_BEFORE_REMINDER, new Date(sessionStart.getTime() - 7 * 24 * 60 * 60 * 1000)),
        communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
        communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
        communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
      ]
    }]
  });

  assert.equal(readiness.items.find((item) => item.key === "calendar")?.ready, true);
  assert.equal(readiness.items.find((item) => item.key === "calendar")?.detail, "1/1 session invite ready");
  assert.equal(readiness.sessionDetails[0]?.calendar.detail, "Invite ready");
});

test("keeps sent reminders satisfied and ignores optional material tasks", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.CREATED,
      calendarEvents: [{
        title: "Session 1",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York",
        inviteUrl: "https://zoom.us/j/123456789"
      }],
      communications: [
        communication(TemplateType.WEEK_BEFORE_REMINDER, new Date("2026-07-03T13:00:00.000Z"), CommunicationStatus.SENT),
        communication(TemplateType.DAY_BEFORE_REMINDER, new Date(sessionStart.getTime() - 24 * 60 * 60 * 1000)),
        communication(TemplateType.HOUR_BEFORE_REMINDER, new Date(sessionStart.getTime() - 60 * 60 * 1000)),
        communication(TemplateType.FOLLOW_UP, new Date(sessionStart.getTime() + 24 * 60 * 60 * 1000))
      ]
    }],
    operationsTasks: [{
      category: OperationsTaskCategory.SESSION_RESOURCES,
      sessionId: "session-1",
      status: OperationsTaskStatus.OPEN
    }]
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.sessionDetails[0]?.emails.stale, []);
  assert.equal(readiness.sessionDetails[0]?.materials.detail, "Optional");
  assert.equal(readiness.items.find((item) => item.key === "manual-tasks")?.ready, true);
});

test("blocks publishing when prep resources are missing unless overridden", () => {
  const base = {
    status: CohortStatus.DRAFT,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      meetingUrl: "https://zoom.us/j/123456789",
      calendarInviteStatus: CalendarInviteStatus.NOT_CREATED,
      communications: []
    }]
  };

  const blocked = getCohortReadiness(base);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.items.find((item) => item.key === "prep-resources")?.detail, "Missing description, guide topic, guide download, podcast link");

  const overridden = getCohortReadiness({ ...base, prepResourcesOptional: true });
  assert.equal(overridden.ready, true);
  assert.equal(overridden.items.find((item) => item.key === "prep-resources")?.detail, "Skipped by cohort override");
});

test("blocks publishing when any session is missing a Zoom link", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    ...readyPrepResources,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      calendarInviteStatus: CalendarInviteStatus.NOT_CREATED,
      communications: []
    }]
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.items.find((item) => item.key === "meeting-links")?.ready, false);
  assert.equal(readiness.items.find((item) => item.key === "meeting-links")?.detail, "0/1 session Zoom link ready");
});

test("keeps a ready cohort in Draft until publication is explicitly authorized", () => {
  assert.equal(deriveCohortStatus({
    status: CohortStatus.DRAFT,
    sessions: [{ startTime: sessionStart, endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000) }]
  }, new Date("2026-07-10T14:30:00.000Z")), CohortStatus.DRAFT);
});
