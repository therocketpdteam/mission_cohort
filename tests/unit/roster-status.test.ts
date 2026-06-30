import assert from "node:assert/strict";
import test from "node:test";
import { ParticipantListStatus } from "@prisma/client";
import { countParticipantsMissingTitles, deriveParticipantListStatus, shouldDefaultPrimaryContactParticipant } from "../../src/lib/rosterStatus";

test("defaults the POC only for an empty one-seat registration", () => {
  assert.equal(shouldDefaultPrimaryContactParticipant(1, 0), true);
  assert.equal(shouldDefaultPrimaryContactParticipant(2, 0), false);
  assert.equal(shouldDefaultPrimaryContactParticipant(1, 1), false);
});

test("derives roster status from expected and saved participant counts", () => {
  assert.equal(deriveParticipantListStatus(0, 0), ParticipantListStatus.NOT_REQUESTED);
  assert.equal(deriveParticipantListStatus(2, 0), ParticipantListStatus.NEEDED);
  assert.equal(deriveParticipantListStatus(2, 1), ParticipantListStatus.PARTIAL);
  assert.equal(deriveParticipantListStatus(2, 2), ParticipantListStatus.COMPLETE);
  assert.equal(deriveParticipantListStatus(2, 3), ParticipantListStatus.COMPLETE);
});

test("keeps roster partial when saved participants are missing titles", () => {
  assert.equal(countParticipantsMissingTitles([{ title: "Principal" }, { title: "" }, { title: null }]), 2);
  assert.equal(deriveParticipantListStatus(2, 2, 1), ParticipantListStatus.PARTIAL);
  assert.equal(deriveParticipantListStatus(0, 1, 1), ParticipantListStatus.PARTIAL);
});
