import assert from "node:assert/strict";
import test from "node:test";
import { ParticipantStatus, PaymentStatus } from "@prisma/client";
import { calculatePartialParticipantMoveFinance, summarizeBulkParticipantMove } from "../../src/services/participantService";

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

test("splits paid value into the target registration for partial participant moves", () => {
  const finance = calculatePartialParticipantMoveFinance({
    sourceTotalAmount: 1425,
    sourcePaidAmount: 1425,
    sourceParticipantCount: 5,
    movedCount: 2,
    targetUnitAmount: 295,
    sourcePaymentStatus: PaymentStatus.PAID
  });

  assert.equal(finance.remainingCount, 3);
  assert.equal(finance.targetTotalAmount, 590);
  assert.equal(finance.targetPaidAmount, 590);
  assert.equal(finance.targetPaymentStatus, PaymentStatus.PAID);
  assert.equal(finance.sourceTotalAfter, 835);
  assert.equal(finance.sourcePaidAfter, 835);
  assert.equal(finance.sourcePaymentStatus, PaymentStatus.PAID);
});

test("keeps unpaid partial participant moves invoiceable instead of comped", () => {
  const finance = calculatePartialParticipantMoveFinance({
    sourceTotalAmount: 1180,
    sourcePaidAmount: 0,
    sourceParticipantCount: 4,
    movedCount: 1,
    targetUnitAmount: 295,
    sourcePaymentStatus: PaymentStatus.INVOICED
  });

  assert.equal(finance.remainingCount, 3);
  assert.equal(finance.targetTotalAmount, 295);
  assert.equal(finance.targetPaidAmount, 0);
  assert.equal(finance.targetPaymentStatus, PaymentStatus.INVOICED);
  assert.equal(finance.sourceTotalAfter, 885);
  assert.equal(finance.sourcePaidAfter, 0);
  assert.equal(finance.sourcePaymentStatus, PaymentStatus.INVOICED);
});
