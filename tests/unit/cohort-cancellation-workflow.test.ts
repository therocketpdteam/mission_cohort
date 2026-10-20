import assert from "node:assert/strict";
import test from "node:test";
import { cancellationBlocksDelivery, cancellationNoticeCanSend, cohortCancellationRecipients, runCohortCancellationSteps } from "../../src/modules/cohorts/cancellation";

test("POCs receive administrative notices even without a saved participant roster", () => {
  assert.deepEqual(cohortCancellationRecipients([{ id: "registration-1", primaryContactEmail: " Avery@Example.com ", participants: [] }]), [
    { role: "poc", registrationId: "registration-1", participantId: undefined, email: "avery@example.com" }
  ]);
});

test("POCs on the participant roster receive only the administrative version while other participants are deduplicated", () => {
  const recipients = cohortCancellationRecipients([
    { id: "registration-1", primaryContactEmail: "avery@example.com", participants: [
      { id: "p1", email: "AVERY@example.com", status: "REGISTERED" },
      { id: "p2", email: "Jordan@Example.com", status: "REGISTERED" },
      { id: "p3", email: "old@example.com", status: "CANCELLED" }
    ] },
    { id: "registration-2", primaryContactEmail: "second@example.com", participants: [
      { id: "p4", email: "jordan@example.com", status: "REGISTERED" }
    ] }
  ]);
  assert.equal(recipients.filter((row) => row.email === "avery@example.com").length, 1);
  assert.equal(recipients.filter((row) => row.email === "jordan@example.com").length, 1);
  assert.equal(recipients.filter((row) => row.role === "poc").length, 2);
  assert.ok(!recipients.some((row) => row.email === "old@example.com"));
});

test("a POC with two registrations receives separate administrative records for each registration", () => {
  const recipients = cohortCancellationRecipients([
    { id: "r1", primaryContactEmail: "avery@example.com", participants: [] },
    { id: "r2", primaryContactEmail: "avery@example.com", participants: [] }
  ]);
  assert.deepEqual(recipients.map((row) => row.registrationId), ["r1", "r2"]);
});

test("historical data-only records never acquire outbound cancellation messages", () => {
  assert.deepEqual(cohortCancellationRecipients([
    { id: "r1", primaryContactEmail: "old@example.com", source: "historical_import", participants: [] },
    { id: "r2", primaryContactEmail: "old2@example.com", externalSource: "historical_import", participants: [] }
  ]), []);
});

test("cancellation sends notices before calendar removal and final status changes", async () => {
  const actions: string[] = [];
  const result = await runCohortCancellationSteps({
    preflight: async () => { actions.push("preflight"); },
    pauseReminders: async () => { actions.push("pause"); },
    sendNotices: async () => { actions.push("emails"); },
    removeCalendar: async () => { actions.push("calendar"); },
    finalize: async () => { actions.push("statuses"); return "cancelled"; }
  });
  assert.deepEqual(actions, ["preflight", "pause", "emails", "calendar", "statuses"]);
  assert.equal(result, "cancelled");
});

for (const failAt of ["preflight", "pauseReminders", "sendNotices", "removeCalendar"] as const) {
  test(`a failure during ${failAt} never marks cohort or participants cancelled`, async () => {
    const actions: string[] = [];
    const step = (name: string) => async () => { actions.push(name); if (name === failAt) throw new Error("provider failed"); };
    await assert.rejects(runCohortCancellationSteps({
      preflight: step("preflight"), pauseReminders: step("pauseReminders"),
      sendNotices: step("sendNotices"), removeCalendar: step("removeCalendar"),
      finalize: step("finalize")
    }), /provider failed/);
    assert.ok(!actions.includes("finalize"));
    if (failAt === "sendNotices") assert.ok(!actions.includes("removeCalendar"));
  });
}

test("retry skips accepted notices and requires delivery review for uncertain or failed sends", () => {
  assert.equal(cancellationNoticeCanSend("SENT"), false);
  assert.equal(cancellationNoticeCanSend("DRAFT"), true);
  for (const status of ["SENDING", "FAILED", "CANCELLED"]) assert.throws(() => cancellationNoticeCanSend(status), /delivery review/);
});

test("pending cancellation blocks normal journey and scheduled messages while allowing its own notices", () => {
  for (const status of ["OPEN", "IN_PROGRESS"]) {
    assert.equal(cancellationBlocksDelivery("c1", "registration:r1:confirmation", status), true);
    assert.equal(cancellationBlocksDelivery("c1", null, status), true);
    assert.equal(cancellationBlocksDelivery("c1", "cohort:c1:cancellation:poc:r1:avery@example.com", status), false);
    assert.equal(cancellationBlocksDelivery("c1", "cohort:other:cancellation:poc:r1", status), true);
  }
  assert.equal(cancellationBlocksDelivery("c1", null, undefined), false);
  assert.equal(cancellationBlocksDelivery("c1", null, "COMPLETED"), false);
});
