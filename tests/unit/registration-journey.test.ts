import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationMilestones } from "../../src/services/registrationJourneyService";

const cohortStart = new Date("2026-08-15T14:00:00.000Z");

test("schedules both cohort milestones for an early registration", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-07-01T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [true, true]);
  assert.equal(milestones[0]?.scheduledFor.toISOString(), "2026-07-16T14:00:00.000Z");
  assert.equal(milestones[1]?.scheduledFor.toISOString(), "2026-08-08T14:00:00.000Z");
});

test("skips the one-month message but keeps the one-week message for a late registration", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-07-25T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [false, true]);
});

test("skips both cohort milestones for a registration made inside the final week", () => {
  const milestones = buildRegistrationMilestones(cohortStart, new Date("2026-08-12T14:00:00.000Z"));

  assert.deepEqual(milestones.map((milestone) => milestone.eligible), [false, false]);
});
