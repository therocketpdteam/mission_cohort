import assert from "node:assert/strict";
import test from "node:test";
import {
  changeSummaryRows,
  mergeParticipantAddition,
  mergeParticipantRemoval,
  mergeRegistrationFieldChanges,
  registrationChangeDeliveryNotes,
  registrationPendingChangeCount,
  sentParticipantConfirmationEmails,
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

test("materializing the POC as the billing fallback is not a client-facing change", () => {
  const changes = mergeRegistrationFieldChanges(
    pending(),
    {
      primaryContactName: "Geneva Hinchliffe",
      primaryContactEmail: "ghinchliffe@gallowayschool.org",
      billingContactName: null,
      billingContactEmail: null
    },
    {
      primaryContactName: "Geneva Hinchliffe",
      primaryContactEmail: "ghinchliffe@gallowayschool.org",
      billingContactName: "Geneva Hinchliffe",
      billingContactEmail: "GHINCHLIFFE@GALLOWAYSCHOOL.ORG"
    }
  );

  assert.equal(registrationPendingChangeCount(changes), 0);
});

test("registration change copy describes a PO update without internal product language", () => {
  const changes = mergeRegistrationFieldChanges(
    pending(),
    { purchaseOrderNumber: null },
    { purchaseOrderNumber: "9769" }
  );

  assert.deepEqual(changeSummaryRows(changes), ["PO number: None → 9769"]);
  assert.deepEqual(registrationChangeDeliveryNotes(changes, { pdfUrl: "https://example.com/invoice.pdf" }), [
    "An updated invoice reflecting these changes is attached. Please use this version for your records."
  ]);
});

test("registration change copy explains only the relevant roster and contact effects", () => {
  const changes = mergeParticipantAddition(
    mergeRegistrationFieldChanges(
      pending(),
      { primaryContactEmail: "old@example.com" },
      { primaryContactEmail: "new@example.com" }
    ),
    chris
  );
  const notes = registrationChangeDeliveryNotes(changes, null);

  assert.equal(notes.length, 2);
  assert.match(notes[0]!, /participant roster and calendar attendee list have been updated/i);
  assert.match(notes[1]!, /updated contact information/i);
  assert.doesNotMatch(notes.join(" "), /Mission Control/i);
});

test("sent participant confirmation recipients are normalized for replay protection", () => {
  const emails = sentParticipantConfirmationEmails([
    {
      status: "SENT" as never,
      recipientEmails: [" Chris@Example.com "],
      template: { name: "Participant Registration Confirmation" }
    },
    {
      status: "FAILED" as never,
      recipientEmails: ["failed@example.com"],
      template: { name: "Participant Registration Confirmation" }
    },
    {
      status: "SENT" as never,
      recipientEmails: ["poc@example.com"],
      template: { name: "Registration Confirmation" }
    }
  ]);

  assert.deepEqual([...emails], ["chris@example.com"]);
});
