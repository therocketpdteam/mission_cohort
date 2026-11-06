import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { mutationOutcome } from "../../src/lib/adminOperations";
import { countPendingRegistrationChanges } from "../../src/lib/registrationPendingChanges";
import { updateRegistration } from "../../src/services/registrationService";
import { updateParticipant } from "../../src/services/participantService";
import { RegistrationPendingChangesPanel } from "../../src/components/admin/RegistrationPendingChangesPanel";
import { RegistrationDeliveryPreflight } from "../../src/components/admin/RegistrationDeliveryPreflight";

function fixture() {
  const registration: any = {
    id: "r1", cohortId: "c1", primaryContactName: "Avery Brooks", primaryContactEmail: "avery@example.org",
    participantCount: 1, participantListStatus: "COMPLETE", paymentStatus: "PAID", totalAmount: 795,
    purchaseOrderNumber: null, pendingChanges: null, pendingChangesAt: null, _count: { participants: 1 },
    cohort: { status: "ACTIVE" }, updatedAt: new Date("2026-11-06T00:00:00Z")
  };
  const participant = { id: "p1", registrationId: "r1", cohortId: "c1", firstName: "Avery", lastName: "Brooks", email: "avery@example.org", title: "Teacher", status: "REGISTERED", registration: { cohortId: "c1" } };
  const originals: Array<[any, string, any]> = [];
  function replace(target: any, key: string, value: any) { originals.push([target, key, target[key]]); target[key] = value; }
  replace(prisma.registration, "findUniqueOrThrow", async () => structuredClone(registration));
  // Roster reconciliation and unrelated CRM lookup are outside this fixture.
  replace(prisma.registration, "findUnique", async () => null);
  replace(prisma.registration, "update", async ({ data }: any) => {
    Object.assign(registration, data, { updatedAt: new Date(registration.updatedAt.getTime() + 1) });
    if (data.pendingChanges === Prisma.JsonNull) registration.pendingChanges = null;
    return structuredClone(registration);
  });
  replace(prisma.participant, "count", async () => 1);
  replace(prisma.participant, "findUnique", async () => null);
  replace(prisma.participant, "findUniqueOrThrow", async () => structuredClone(participant));
  replace(prisma.participant, "update", async ({ data }: any) => ({ ...participant, ...data }));
  replace(prisma.cohort, "findUniqueOrThrow", async () => ({ status: "ACTIVE" }));
  replace(globalThis, "fetch", async () => { throw new Error("This save must not send emails or change calendars"); });
  return { registration, restore: () => originals.reverse().forEach(([target, key, value]) => { target[key] = value; }) };
}

test("saving an internal registration note does not ask for Apply when there are no delivery changes", async () => {
  const f = fixture();
  try {
    const saved = await updateRegistration("r1", { notes: "Internal review completed" }, { deferNotifications: true });
    assert.equal(("status" in saved.journey ? saved.journey.status : undefined), "no_changes");
    assert.equal(mutationOutcome(saved).state, "success");
    assert.equal(countPendingRegistrationChanges(saved.pendingChanges), 0);
  } finally { f.restore(); }
});

test("a POC edit returns the persisted before/after summary and renders an Apply button immediately", async () => {
  const f = fixture();
  const originalReact = (globalThis as any).React;
  (globalThis as any).React = React;
  try {
    const saved = await updateRegistration("r1", { primaryContactEmail: "updated@example.org" }, { deferNotifications: true });
    assert.equal(("status" in saved.journey ? saved.journey.status : undefined), "pending_apply");
    assert.deepEqual(saved.pendingChanges, f.registration.pendingChanges);
    assert.deepEqual((saved.pendingChanges as any).fields.primaryContactEmail, { before: "avery@example.org", after: "updated@example.org" });
    assert.equal(mutationOutcome(saved).state, "warning");
    const html = renderToStaticMarkup(React.createElement(RegistrationPendingChangesPanel, { registration: saved, onApplied: () => {}, onError: () => {} }));
    assert.match(html, /Apply Changes/);
    assert.match(html, /Primary contact email/);
    assert.match(html, /avery@example.org → updated@example.org/);
    const preflight = renderToStaticMarkup(React.createElement(RegistrationDeliveryPreflight, { registration: saved }));
    // The billing email follows the POC when no separate billing contact is set.
    assert.match(preflight, /2 registration field changes waiting for Apply/);
    assert.doesNotMatch(preflight, /No saved delivery changes are waiting for Apply|No participant add\/remove batch is waiting for Apply/);
  } finally { (globalThis as any).React = originalReact; f.restore(); }
});

test("reverting a PO to its original empty value clears the saved change and its warning", async () => {
  const f = fixture();
  try {
    await updateRegistration("r1", { purchaseOrderNumber: "PO-1" }, { deferNotifications: true });
    const revised = await updateRegistration("r1", { purchaseOrderNumber: "PO-2" }, { deferNotifications: true });
    assert.deepEqual((revised.pendingChanges as any).fields.purchaseOrderNumber, { before: null, after: "PO-2" });
    // Clearing an optional field is represented by an empty string in the editor.
    const reverted = await updateRegistration("r1", { purchaseOrderNumber: "" }, { deferNotifications: true });
    assert.equal(reverted.pendingChanges, null);
    assert.equal(reverted.pendingChangesAt, null);
    assert.equal(mutationOutcome(reverted).state, "success");
  } finally { f.restore(); }
});

test("participant profile edits do not fabricate a pending Apply batch", async () => {
  const f = fixture();
  try {
    const saved = await updateParticipant("p1", { title: "Principal" }, { deferNotifications: true });
    assert.equal(("status" in saved.journey ? saved.journey.status : undefined), "no_changes");
    assert.equal(mutationOutcome(saved).state, "success");
    const staged = await updateRegistration("r1", { primaryContactName: "Avery B. Brooks" }, { deferNotifications: true });
    const next = await updateParticipant("p1", { title: "Principal" }, { deferNotifications: true });
    assert.equal(("status" in next.journey ? next.journey.status : undefined), "pending_apply");
    assert.equal((next.journey as any).pendingChangeCount, countPendingRegistrationChanges(staged.pendingChanges));
  } finally { f.restore(); }
});
