import assert from "node:assert/strict";
import test from "node:test";
import { pricePerParticipantForCohort, registrationTotalAfterSeatChange, registrationTotalForCohort } from "../../src/config/cohortPricing";

test("uses configured cohort price before fallback matrix", () => {
  assert.equal(pricePerParticipantForCohort({ pricePerParticipant: 925, sessions: new Array(8) }), 925);
  assert.equal(registrationTotalForCohort({ pricePerParticipant: "925", sessions: new Array(8) }, 2), 1850);
});

test("uses session-count fallback pricing when cohort price is empty", () => {
  assert.equal(pricePerParticipantForCohort({ pricePerParticipant: 0, sessions: new Array(3) }), 595);
  assert.equal(registrationTotalForCohort({ pricePerParticipant: 0, _count: { sessions: 4 } }, 3), 2085);
});

test("updates roster pricing with the cohort rate", () => {
  assert.equal(registrationTotalAfterSeatChange(
    { pricePerParticipant: 795, sessions: new Array(5) },
    { participantCount: 7, totalAmount: 5565, paymentMethod: "INVOICE" },
    11
  ), 8745);
});

test("preserves a negotiated per-seat rate when seats are added", () => {
  assert.equal(registrationTotalAfterSeatChange(
    { pricePerParticipant: 795, sessions: new Array(5) },
    { participantCount: 7, totalAmount: 4900, paymentMethod: "INVOICE" },
    11
  ), 7700);
});

test("keeps comped registrations at zero when seats are added", () => {
  assert.equal(registrationTotalAfterSeatChange(
    { pricePerParticipant: 795 },
    { participantCount: 1, totalAmount: 0, paymentMethod: "COMPED" },
    2
  ), 0);
});

test("applies five-session volume tiers for cohorts configured at the 495 base rate", () => {
  const cohort = { pricePerParticipant: 495, sessions: new Array(5) };
  assert.equal(registrationTotalForCohort(cohort, 4), 1980);
  assert.equal(registrationTotalForCohort(cohort, 5), 2425);
  assert.equal(registrationTotalForCohort(cohort, 13), 6045);
  assert.equal(registrationTotalForCohort(cohort, 18), 8370);
  assert.equal(registrationTotalForCohort(cohort, 20), 9100);
  assert.equal(registrationTotalForCohort(cohort, 100), 42500);
});

test("recalculates a standard tiered registration when seats cross a volume boundary", () => {
  const cohort = { pricePerParticipant: 495, sessions: new Array(5) };
  assert.equal(registrationTotalAfterSeatChange(cohort, {
    participantCount: 9,
    totalAmount: 4365,
    paymentMethod: "INVOICE"
  }, 10), 4650);
  assert.equal(registrationTotalAfterSeatChange(cohort, {
    participantCount: 13,
    totalAmount: 6045,
    paymentMethod: "INVOICE"
  }, 18), 8370);
});
