import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeParticipantAddition,
  mergeParticipantRemoval,
  mergeRegistrationFieldChanges,
  registrationPendingChangeCount,
  type RegistrationPendingChanges
} from "../../src/services/registrationChangeService";

function pending(): RegistrationPendingChanges {
  return {
    batchId: "batch-1",
    participantAdditions: [],
    participantRemovals: [],
    fields: {},
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

const chris = { participantId: "participant-1", firstName: "Chris", lastName: "Example", email: "chris@example.com" };

test("adding then removing a new participant cancels the pending delivery change", () => {
  const added = mergeParticipantAddition(pending(), chris);
  const removed = mergeParticipantRemoval(added, chris);

  assert.equal(registrationPendingChangeCount(removed), 0);
});

test("re-registering the same existing participant cancels a pending removal", () => {
  const removed = mergeParticipantRemoval(pending(), chris);
  const restored = mergeParticipantAddition(removed, chris);

  assert.equal(registrationPendingChangeCount(restored), 0);
});

test("registration field edits preserve the original value across repeated saves", () => {
  const first = mergeRegistrationFieldChanges(pending(), { participantCount: 1 }, { participantCount: 2 });
  const second = mergeRegistrationFieldChanges(first, { participantCount: 2 }, { participantCount: 3 });

  assert.deepEqual(second.fields.participantCount, { before: 1, after: 3 });
});

test("changing a registration field back to its original value removes it from review", () => {
  const first = mergeRegistrationFieldChanges(pending(), { totalAmount: 795 }, { totalAmount: 1590 });
  const reverted = mergeRegistrationFieldChanges(first, { totalAmount: 1590 }, { totalAmount: 795 });

  assert.equal(registrationPendingChangeCount(reverted), 0);
});
