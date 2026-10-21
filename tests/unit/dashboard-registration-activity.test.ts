import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationActivity, registrationActivityWindow } from "../../src/lib/registrationActivity";
import { getDashboardRegistrationActivity } from "../../src/services/dashboardRegistrationActivityService";

const now = new Date("2026-10-21T17:00:00Z");

test("registration activity includes ten consecutive weeks and all registrations beyond the recent six", () => {
  const rows = [
    ...Array.from({ length: 12 }, () => ({ createdAt: "2026-08-18T12:00:00Z" })),
    ...Array.from({ length: 6 }, () => ({ createdAt: "2026-10-20T12:00:00Z" }))
  ];
  const activity = buildRegistrationActivity(rows, now);
  assert.equal(activity.buckets.length, 10);
  assert.equal(activity.from, "2026-08-17T04:00:00.000Z");
  assert.equal(activity.through, now.toISOString());
  assert.equal(activity.buckets[0].weekStart, "2026-08-17");
  assert.equal(activity.buckets[9].weekStart, "2026-10-19");
  assert.deepEqual(activity.buckets.map((bucket) => bucket.count), [12, 0, 0, 0, 0, 0, 0, 0, 0, 6]);
  assert.equal(activity.total, 18);
  assert.deepEqual(activity.buckets.filter((bucket) => bucket.currentWeek).map((bucket) => bucket.weekStart), ["2026-10-19"]);
});

test("registration activity includes the start boundary and excludes invalid, future and out-of-range records", () => {
  const activity = buildRegistrationActivity([
    { createdAt: "2026-08-17T03:59:59.999Z" },
    { createdAt: "2026-08-17T04:00:00Z" },
    { createdAt: new Date("2026-10-21T16:59:59Z") },
    { createdAt: now }, { createdAt: "2026-12-01T12:00:00Z" },
    { createdAt: "invalid" }, { createdAt: null }, {}
  ], now);
  assert.equal(activity.total, 2);
  assert.equal(activity.buckets[0].count, 1);
  assert.equal(activity.buckets[9].count, 1);
});

test("weeks use Eastern Monday boundaries across daylight-saving changes", () => {
  const activity = buildRegistrationActivity([
    { createdAt: "2026-11-02T04:59:59Z" },
    { createdAt: "2026-11-02T05:00:00Z" }
  ], new Date("2026-11-03T12:00:00Z"));
  assert.equal(activity.from, "2026-08-31T04:00:00.000Z");
  assert.equal(activity.buckets[8].weekStart, "2026-10-26");
  assert.equal(activity.buckets[8].count, 1);
  assert.equal(activity.buckets[9].weekStart, "2026-11-02");
  assert.equal(activity.buckets[9].count, 1);
  const winterWindow = registrationActivityWindow(new Date("2027-02-09T12:00:00Z"));
  assert.equal(winterWindow.start.toISOString(), "2026-12-07T05:00:00.000Z");
});

test("empty registration history still returns ten zero weeks across a year boundary", () => {
  const activity = buildRegistrationActivity([], new Date("2027-01-04T12:00:00Z"));
  assert.equal(activity.buckets.length, 10);
  assert.equal(activity.buckets[0].weekStart, "2026-11-02");
  assert.equal(activity.buckets[9].weekStart, "2027-01-04");
  assert.equal(activity.total, 0);
  assert.ok(activity.buckets.every((bucket) => bucket.count === 0));
});

test("dashboard history query preserves cohort scope without the recent-registration pagination limit", async () => {
  const scope = { cohort: { status: { in: ["PUBLISHED", "ACTIVE"] } }, cohortId: "selected-cohort" };
  let query: any;
  const client = { registration: { findMany: async (input: any) => {
    query = input;
    return Array.from({ length: 17 }, () => ({ createdAt: new Date("2026-09-01T12:00:00Z") }));
  } } } as unknown as NonNullable<Parameters<typeof getDashboardRegistrationActivity>[2]>;
  const activity = await getDashboardRegistrationActivity(scope as any, now, client);
  assert.deepEqual(query, {
    where: { ...scope, archivedAt: null, createdAt: { gte: new Date("2026-08-17T04:00:00Z"), lt: now } },
    select: { createdAt: true }
  });
  assert.equal(activity.total, 17);
  assert.equal(activity.buckets[2].count, 17);
});
