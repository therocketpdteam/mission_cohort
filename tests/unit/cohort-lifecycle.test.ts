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
import { deriveCohortStatus, getCohortReadiness } from "../../src/services/cohortLifecycle";

const sessionStart = new Date("2026-07-10T14:00:00.000Z");

function communication(type: TemplateType, scheduledFor: Date, status: CommunicationStatus = CommunicationStatus.SCHEDULED) {
  return { template: { type }, scheduledFor, status };
}

test("treats complete draft session plans as publish-ready before provider delivery", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
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
  assert.equal(readiness.sessionDetails[0]?.emails.total, 4);
});

test("keeps sent reminders satisfied and ignores optional material tasks", () => {
  const readiness = getCohortReadiness({
    status: CohortStatus.DRAFT,
    sessions: [{
      id: "session-1",
      title: "Session 1",
      startTime: sessionStart,
      endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      timezone: "America/New_York",
      calendarInviteStatus: CalendarInviteStatus.CREATED,
      calendarEvents: [{
        title: "Session 1",
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000),
        timezone: "America/New_York"
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

test("keeps a ready cohort in Draft until publication is explicitly authorized", () => {
  assert.equal(deriveCohortStatus({
    status: CohortStatus.DRAFT,
    sessions: [{ startTime: sessionStart, endTime: new Date(sessionStart.getTime() + 60 * 60 * 1000) }]
  }, new Date("2026-07-10T14:30:00.000Z")), CohortStatus.DRAFT);
});
