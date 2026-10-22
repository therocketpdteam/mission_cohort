import test from "node:test";
import assert from "node:assert/strict";
import { dashboardOperationalRows, registrationLinePoints, unresolvedDeliveryRecipients } from "../../src/lib/dashboardPresentation";
import { dashboardHealth } from "../../src/services/dashboardHealthService";

test("operational headline and cohort rows count the same actual tasks, including calendar tasks", () => {
  const rows = dashboardOperationalRows([{ id: "1", status: "OPEN", category: "CALENDAR_INVITE", cohortId: "c1", cohort: { id: "c1", title: "One" } }, { id: "2", status: "IN_PROGRESS", cohortId: "c2", cohort: { id: "c2", title: "Two" } }, { id: "3", status: "COMPLETED", cohortId: "c3" }]);
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.tasks.length), [1, 1]); assert.equal(rows.reduce((sum, row) => sum + row.tasks.length, 0), 2);
  assert.deepEqual(dashboardOperationalRows([], [{ cohortId: "c", title: "No tasks" }]), []);
});
test("line points retain ten full weeks and exact zero weeks, with a safe empty scale", () => {
  const points = registrationLinePoints([12, 0, 3, 1, 8, 0, 5, 2, 4, 6]);
  assert.equal(points.length, 10); assert.equal(points[0].x, 5); assert.equal(points[9].x, 95); assert.equal(points[0].y, 20); assert.equal(points[1].y, 90);
  assert.ok(registrationLinePoints(Array(10).fill(0)).every(point => point.y === 90 && Number.isFinite(point.x)));
  assert.deepEqual(registrationLinePoints([]), []); assert.equal(registrationLinePoints([2])[0].x, 50);
});
test("delivery count deduplicates recipients within a message and ignores reviewed or recovered failures", () => {
  const failure = { communicationId: "c", recipientEmail: "JO@example.com", eventType: "FAILED", createdAt: new Date("2026-10-21T10:00:00Z") };
  const recovery = { ...failure, recipientEmail: "jo@example.com", eventType: "DELIVERED", createdAt: new Date("2026-10-21T11:00:00Z") };
  assert.equal(unresolvedDeliveryRecipients([failure, { ...failure }], []).length, 1);
  assert.equal(unresolvedDeliveryRecipients([failure], [recovery]).length, 0);
  assert.equal(unresolvedDeliveryRecipients([{ ...failure, reviewedAt: new Date() }], []).length, 0);
  assert.equal(unresolvedDeliveryRecipients([failure], [{ ...recovery, communicationId: "unrelated" }]).length, 1);
  assert.equal(unresolvedDeliveryRecipients([failure], [{ ...recovery, createdAt: new Date("2026-10-20") }]).length, 1);
});
test("unlinked deliveries recover only through their own provider message", () => {
  const failure = { communicationId: null, provider: "sendgrid", providerMessageId: "message1", recipientEmail: "jo@example.com", eventType: "FAILED", createdAt: new Date("2026-10-21T10:00:00Z") };
  const recovery = { ...failure, eventType: "DELIVERED", createdAt: new Date("2026-10-21T11:00:00Z") };
  assert.equal(unresolvedDeliveryRecipients([failure], [{ ...recovery, providerMessageId: "message2" }]).length, 1);
  assert.equal(unresolvedDeliveryRecipients([failure], [recovery]).length, 0);
});
const now = new Date("2026-10-21T18:00:00Z");
function client(options: { stale?: boolean; queue?: number; jobs?: number; calendar?: boolean; fail?: boolean } = {}) {
  const resolve = (value: unknown) => options.fail ? Promise.reject(new Error("Database check unavailable")) : Promise.resolve(value);
  return { auditLog: { findFirst: () => resolve({ createdAt: new Date(now.getTime() - (options.stale ? 30 : 2) * 60_000) }) }, cohortCommunication: { count: () => resolve(options.queue ?? 0) }, integrationSyncJob: { count: () => resolve(options.jobs ?? 0) }, appSetting: { findMany: () => resolve(options.calendar ? [{ key: "cohort.staffCalendar.c" }] : []) } } as any;
}
test("health reports measured failures with actionable routes and never changes them to green", async () => {
  const { checks } = await dashboardHealth(client({ stale: true, queue: 4, jobs: 2, calendar: true }), now, true);
  assert.deepEqual(checks.map(check => check.status), ["warning", "warning", "error", "error"]);
  assert.match(checks[1].label, /4 overdue/); assert.equal(checks[3].href, "/cohorts/c");
});
test("unavailable health data is unknown instead of success, while disabled jobs are paused", async () => {
  assert.ok((await dashboardHealth(client({ fail: true }), now, true)).checks.every(check => check.status === "unknown"));
  assert.equal((await dashboardHealth(client(), now, false)).checks[0].status, "warning");
  assert.ok((await dashboardHealth(client(), now, true)).checks.every(check => check.status === "healthy"));
});
