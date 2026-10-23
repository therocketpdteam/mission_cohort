import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateParticipantGroups, uniqueActiveParticipantCount } from "../../src/lib/duplicateParticipants";

const participants = [
  { id: "p1", email: " JoAnna@Example.com ", firstName: "JoAnna", lastName: "Hargan", status: "REGISTERED", registrationId: "r1", registration: { id: "r1", status: "NEW" } },
  { id: "p2", email: "joanna@example.com", firstName: "Joanna", lastName: "Hargan", status: "REGISTERED", registrationId: "r2", registration: { id: "r2", status: "NEW" } },
  { id: "p3", email: "other@example.com", firstName: "Other", lastName: "Person", status: "REGISTERED", registrationId: "r3", registration: { id: "r3", status: "NEW" } }
];

test("detects the same active participant email across separate registrations", () => {
  const groups = findDuplicateParticipantGroups(participants);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.email, "joanna@example.com");
  assert.deepEqual(groups[0]?.registrationIds, ["r1", "r2"]);
  assert.equal(uniqueActiveParticipantCount(participants), 2);
});

test("does not flag cancelled registrations or duplicate rows within one registration", () => {
  const rows = [
    participants[0]!,
    { ...participants[1]!, registrationId: "r1", registration: { id: "r1", status: "NEW" } },
    { ...participants[1]!, id: "p4", registrationId: "r4", registration: { id: "r4", status: "CANCELLED" } }
  ];
  assert.deepEqual(findDuplicateParticipantGroups(rows), []);
  assert.equal(uniqueActiveParticipantCount(rows), 1);
});
