import assert from "node:assert/strict";
import test from "node:test";
import { ParticipantStatus } from "@prisma/client";
import { summarizeBulkParticipantMove } from "../../src/services/participantService";

test("summarizes individual participant moves without treating whole registrations as moved", () => {
  const summary = summarizeBulkParticipantMove([
    {
      id: "participant-1",
      registrationId: "registration-1",
      cohortId: "source-cohort",
      organizationId: "organization-1",
      email: "one@example.com",
      status: ParticipantStatus.REGISTERED
    },
    {
      id: "participant-2",
      registrationId: "registration-1",
      cohortId: "source-cohort",
      organizationId: "organization-1",
      email: "two@example.com",
      status: ParticipantStatus.REGISTERED
    },
    {
      id: "participant-3",
      registrationId: "registration-2",
      cohortId: "target-cohort",
      organizationId: "organization-2",
      email: "three@example.com",
      status: ParticipantStatus.REGISTERED
    }
  ], "target-cohort");

  assert.equal(summary.requestedCount, 3);
  assert.equal(summary.movedCount, 2);
  assert.equal(summary.skippedAlreadyInTargetCount, 1);
  assert.deepEqual(summary.sourceRegistrationIds, ["registration-1"]);
  assert.deepEqual(summary.sourceCohortIds, ["source-cohort"]);
  assert.deepEqual(summary.organizationIds, ["organization-1"]);
  assert.equal(summary.nonRegisteredCount, 0);
});

test("counts non-registered selected participants before individual moves", () => {
  const summary = summarizeBulkParticipantMove([
    {
      id: "participant-1",
      registrationId: "registration-1",
      cohortId: "source-cohort",
      organizationId: "organization-1",
      email: "one@example.com",
      status: ParticipantStatus.CANCELLED
    }
  ], "target-cohort");

  assert.equal(summary.movedCount, 1);
  assert.equal(summary.nonRegisteredCount, 1);
});
