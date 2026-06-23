import assert from "node:assert/strict";
import test from "node:test";
import { pricePerParticipantForCohort, registrationTotalForCohort } from "../../src/config/cohortPricing";

test("uses configured cohort price before fallback matrix", () => {
  assert.equal(pricePerParticipantForCohort({ pricePerParticipant: 925, sessions: new Array(8) }), 925);
  assert.equal(registrationTotalForCohort({ pricePerParticipant: "925", sessions: new Array(8) }, 2), 1850);
});

test("uses session-count fallback pricing when cohort price is empty", () => {
  assert.equal(pricePerParticipantForCohort({ pricePerParticipant: 0, sessions: new Array(3) }), 595);
  assert.equal(registrationTotalForCohort({ pricePerParticipant: 0, _count: { sessions: 4 } }, 3), 2085);
});
