import test from "node:test";
import assert from "node:assert/strict";
import { adminApi } from "../../src/lib/adminApi";
import { beginOperation, describeEntityChange, dismissOperation, finishOperation, hydrateOperations, mutationOutcome, operationDestination, operationSnapshot, projectEntityRows, resetOperations } from "../../src/lib/adminOperations";

function browser() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/participants", search: "" }, sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value), getItem: (key: string) => storage.get(key) } } });
  resetOperations(); return storage;
}
const originalFetch = globalThis.fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test.afterEach(() => { resetOperations(); globalThis.fetch = originalFetch; delete (globalThis as any).window; });

test("only routine fields are retained; credentials and send/cancellation actions are excluded", () => {
  browser();
  assert.equal(describeEntityChange("/api/settings", "PATCH", { apiKey: "secret" }), undefined);
  assert.equal(describeEntityChange("/api/participants", "PATCH", { action: "bulkMoveParticipants", ids: ["p"] }), undefined);
  assert.equal(describeEntityChange("/api/cohorts/c", "PATCH", { action: "cancel" }), undefined);
  assert.equal(describeEntityChange("/api/communications", "POST", { subject: "Hello", body: "Private" }), undefined);
  assert.deepEqual(describeEntityChange("/api/participants", "PATCH", { id: "p", firstName: "Jo", apiKey: "secret" })?.values, { firstName: "Jo" });
  assert.equal(describeEntityChange("/api/cohorts/c", "PATCH", { action: "publish" }), undefined);
});
test("routine pending edit projects instantly and rolls back on failure", () => {
  browser(); const base = [{ id: "p", firstName: "Jo", email: "a@example.com" }];
  const operation = beginOperation("/api/participants", "PATCH", { id: "p", firstName: "Jane" }, "/participants");
  assert.equal(projectEntityRows<Record<string, any>>(base, operationSnapshot(), "participants")[0].firstName, "Jane");
  assert.equal(projectEntityRows<Record<string, any>>(base, operationSnapshot(), "participants")[0]._optimistic, true);
  finishOperation(operation.id, undefined, Object.assign(new Error("Invalid email"), { confirmedFailure: true }));
  assert.deepEqual(projectEntityRows<Record<string, any>>(base, operationSnapshot(), "participants"), base);
  assert.equal(operationSnapshot()[0].change?.values.firstName, "Jane");
  assert.equal(operationSnapshot()[0].errorConfirmed, true);
});
test("temporary additions are scoped, confirmed with server ID, and dismissing a notice preserves the row", () => {
  browser(); const operation = beginOperation("/api/participants", "POST", { firstName: "Alex", registrationId: "r", cohortId: "c" }, "/participants");
  assert.equal(projectEntityRows<Record<string, any>>([], operationSnapshot(), "participants", { registrationId: "other" }).length, 0);
  assert.match(projectEntityRows<Record<string, any>>([], operationSnapshot(), "participants", { registrationId: "r" })[0].id, /^pending:/);
  finishOperation(operation.id, { id: "real", registrationId: "r", firstName: "Alex" }); dismissOperation(operation.id);
  assert.equal(projectEntityRows<Record<string, any>>([], operationSnapshot(), "participants")[0].id, "real");
  assert.equal(operationSnapshot()[0].href, "/registrations?id=r");
});
test("nested roster and session drafts survive a page reload; ambiguous creates are never marked safe to retry", () => {
  const storage = browser(); const operation = beginOperation("/api/registrations", "POST", { primaryContactEmail: "p@example.com", participants: [{ firstName: "Jo", email: "j@example.com", token: "omit" }], backgroundDelivery: true, secret: "omit" }, "/registrations");
  const raw = storage.get("mission-cohort-save-recovery")!; assert.ok(!raw.includes("omit"));
  resetOperations(); storage.set("mission-cohort-save-recovery", raw); hydrateOperations();
  const recovered = operationSnapshot()[0]; assert.equal(recovered.state, "error"); assert.equal(recovered.errorConfirmed, false);
  assert.equal(recovered.change?.values.participants[0].firstName, "Jo"); assert.equal(recovered.id, operation.id);
  assert.equal(describeEntityChange("/api/cohorts", "POST", { title: "Course", sessions: [{ title: "Session", startTime: "2026-11-01T15:00:00Z" }] })?.values.sessions[0].title, "Session");
});
test("queued delivery, pending apply, calendar failures and partial failures are warnings, not success", () => {
  assert.equal(mutationOutcome({ journey: { status: "pending_apply" } }).state, "warning");
  assert.equal(mutationOutcome({ deliveryJob: { id: "j", status: "QUEUED" } }).state, "warning");
  assert.equal(mutationOutcome({ calendar: { status: "pending" } }).state, "warning");
  assert.equal(mutationOutcome({ calendar: { status: "failed", error: "Google unavailable" } }).detail, "Google unavailable");
  assert.equal(mutationOutcome({ failed: ["one"] }).state, "warning");
  assert.equal(mutationOutcome({ confirmationFailures: 1 }).state, "warning");
  assert.equal(mutationOutcome({ status: "blocked", blockers: ["Calendar unavailable"] }).state, "warning");
  assert.equal(mutationOutcome({ cancellationEmail: { status: "failed" } }).state, "warning");
  assert.equal(mutationOutcome({ id: "p", calendar: { status: "synced" } }).state, "success");
});
test("delete rollback and subsequent edits preserve order without changing other rows", () => {
  browser(); const base = [{ id: "a", firstName: "A" }, { id: "b", firstName: "B" }];
  const removed = beginOperation("/api/participants?id=a", "DELETE", undefined, "/participants");
  assert.deepEqual(projectEntityRows<Record<string, any>>(base, operationSnapshot(), "participants").map(r => r.id), ["b"]);
  finishOperation(removed.id, undefined, new Error("Calendar unavailable"));
  const first = beginOperation("/api/participants", "PATCH", { id: "b", firstName: "B1" }, "/participants");
  beginOperation("/api/participants", "PATCH", { id: "b", firstName: "B2" }, "/participants");
  finishOperation(first.id, { id: "b", firstName: "B1" });
  assert.deepEqual(projectEntityRows<Record<string, any>>(base, operationSnapshot(), "participants").map(r => r.firstName), ["A", "B2"]);
});
test("nested task/session routes preserve cohort scope and direct links", () => {
  assert.equal(describeEntityChange("/api/cohorts/c/tasks", "POST", { title: "Check calendar" })?.values.cohortId, "c");
  assert.equal(operationDestination("/api/cohorts/c/sessions", { title: "Session" }, "/dashboard"), "/cohorts/c");
  assert.equal(operationDestination("/api/cohorts/c/support-team", {}, "/dashboard"), "/cohorts/c");
  assert.equal(operationDestination("/api/participants", { id: "p" }, "/dashboard", { id: "p", registrationId: "r" }), "/registrations?id=r");
});
test("duplicate submissions share one request, while edits to the same record are serialized", async () => {
  browser(); const releases: Array<(result: Response) => void> = [], bodies: any[] = [];
  globalThis.fetch = (async (_path, options) => { bodies.push(JSON.parse(String(options?.body))); return new Promise<Response>((resolve) => releases.push(resolve)); }) as typeof fetch;
  const first = adminApi("/api/participants", { method: "PATCH", body: { id: "p", firstName: "One" } });
  const duplicate = adminApi("/api/participants", { method: "PATCH", body: { id: "p", firstName: "One" } });
  const second = adminApi("/api/participants", { method: "PATCH", body: { id: "p", firstName: "Two" } });
  assert.equal(bodies.length, 1); assert.equal(operationSnapshot().length, 2);
  releases[0](Response.json({ success: true, data: { id: "p", firstName: "One" } })); await first; await duplicate; await tick();
  assert.equal(bodies.length, 2); assert.equal(bodies[1].firstName, "Two");
  releases[1](Response.json({ success: true, data: { id: "p", firstName: "Two" } })); await second;
  assert.equal(projectEntityRows<Record<string, any>>([{ id: "p" }], operationSnapshot(), "participants")[0].firstName, "Two");
});
test("a rejected request remains an error and a failed save does not block a later edit", async () => {
  browser(); let call = 0;
  globalThis.fetch = (async () => ++call === 1 ? Response.json({ success: false, error: { message: "Duplicate email" } }, { status: 400 }) : Response.json({ success: true, data: { id: "p", email: "new@example.com" } })) as typeof fetch;
  await assert.rejects(adminApi("/api/participants", { method: "PATCH", body: { id: "p", email: "bad@example.com" } }), /Duplicate email/);
  assert.equal(operationSnapshot()[0].state, "error"); assert.equal(operationSnapshot()[0].errorConfirmed, true);
  await adminApi("/api/participants", { method: "PATCH", body: { id: "p", email: "new@example.com" } });
  assert.equal(operationSnapshot()[1].state, "success");
});

test("requests with different delivery instructions are not deduplicated", async () => {
  browser(); const bodies: any[] = [];
  globalThis.fetch = (async (_path, options) => { bodies.push(JSON.parse(String(options?.body))); return Response.json({ success: true, data: { id: "r" } }); }) as typeof fetch;
  await Promise.all([adminApi("/api/registrations", { method: "PATCH", body: { id: "r", participantCount: 2, deferNotifications: true } }), adminApi("/api/registrations", { method: "PATCH", body: { id: "r", participantCount: 2, deferNotifications: false } })]);
  assert.equal(bodies.length, 2); assert.deepEqual(bodies.map((body) => body.deferNotifications), [true, false]);
});

test("a stale refresh cannot undo a confirmed edit, while a newer server version wins", () => {
  browser();
  const operation = beginOperation("/api/participants", "PATCH", { id: "p", firstName: "Latest" }, "/participants");
  finishOperation(operation.id, { id: "p", firstName: "Latest", updatedAt: "2026-10-22T14:02:00Z" });
  const canonical = [{ id: "p", firstName: "Latest", updatedAt: "2026-10-22T14:02:00Z" }];
  assert.equal(projectEntityRows<Record<string, any>>(canonical, operationSnapshot(), "participants")[0].firstName, "Latest");
  assert.equal(projectEntityRows<Record<string, any>>([{ id: "p", firstName: "Old", updatedAt: "2026-10-22T14:01:00Z" }], operationSnapshot(), "participants")[0].firstName, "Latest");
  assert.equal(projectEntityRows<Record<string, any>>([{ id: "p", firstName: "Newer external edit", updatedAt: "2026-10-22T14:03:00Z" }], operationSnapshot(), "participants")[0].firstName, "Newer external edit");
});
test("a stale refresh cannot resurrect a confirmed deletion", () => {
  browser(); const removed = beginOperation("/api/participants?id=p", "DELETE", undefined, "/participants");
  finishOperation(removed.id, { id: "p" });
  assert.equal(projectEntityRows<Record<string, any>>([], operationSnapshot(), "participants").length, 0);
  assert.equal(projectEntityRows<Record<string, any>>([{ id: "p", firstName: "Stale" }], operationSnapshot(), "participants").length, 0);
});
