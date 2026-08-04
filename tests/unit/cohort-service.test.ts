import assert from "node:assert/strict";
import test from "node:test";
import { cohortIdentityKey } from "../../src/services/cohortService";
import { cohortCreateSchema } from "../../src/validators/cohort";

test("cohort titles are reusable while slug and short name identify the cohort", () => {
  const parsed = cohortCreateSchema.parse({
    title: " Rethinking teacher supervision, coaching & evaluation ",
    shortName: " KM Fall 2026 ",
    slug: "km-fall-2026",
    presenterId: "presenter-1",
    startDate: "2026-09-24T19:30:00.000Z",
    endDate: "2026-11-12T21:30:00.000Z"
  });

  assert.equal(parsed.title, "Rethinking teacher supervision, coaching & evaluation");
  assert.equal(parsed.shortName, "KM Fall 2026");
  assert.equal(parsed.slug, "km-fall-2026");
  assert.equal(cohortIdentityKey("KM Fall 2026"), cohortIdentityKey("KM-Fall-2026"));
  assert.notEqual(cohortIdentityKey("KM Fall 2025"), cohortIdentityKey("KM Fall 2026"));
});
