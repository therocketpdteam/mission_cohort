import test from "node:test";
import assert from "node:assert/strict";
import { defaultAttributionRules, resolveRegistrationAttribution, summarizeAttribution, type AttributionRule } from "../../src/lib/registrationAttribution";
import { reportRegistrationAttribution, getCohortInsightsReport } from "../../src/services/reportService";
import { normalizeJotformRegistrationPayload } from "../../src/modules/jotform/normalizer";
import { getAttributionRules, saveAttributionRules } from "../../src/services/attributionRuleService";
import { prisma } from "../../src/lib/prisma";
import { formatRegistrationSource } from "../../src/lib/formatting";
const rules: AttributionRule[] = [...defaultAttributionRules, { id: "tl", source: "tl-newsletter", medium: "email", campaign: "", owner: "THOUGHT_LEADER" }];
test("Jotform and untagged RocketPD pages do not prove marketing ownership", () => {
  const value = resolveRegistrationAttribution({ source: "jotform", landingPageUrl: "https://rocketpd.com/cohorts/leadership" }, rules);
  assert.equal(value.owner, "UNASSIGNED"); assert.equal(value.tagged, false); assert.equal(value.intake, "jotform");
  assert.match(formatRegistrationSource({ source: "jotform" }), /Unknown marketing source/);
  assert.equal(resolveRegistrationAttribution({ referrerUrl: "https://google.com/" }).owner, "UNASSIGNED");
});
test("explicit fields win over URL tags, and URL tags preserve campaign and medium details", () => {
  const url = "https://rocketpd.com/c?utm_source=rocketpd&amp;utm_medium=email&amp;utm_campaign=fall%202026";
  const value = resolveRegistrationAttribution({ source: "jotform", landingPageUrl: url }, rules);
  assert.equal(value.source, "rocketpd"); assert.equal(value.medium, "email"); assert.equal(value.campaign, "fall 2026"); assert.equal(value.owner, "ROCKET_PD"); assert.equal(value.basis, "Tagged URL");
  assert.equal(resolveRegistrationAttribution({ landingPageUrl: url, utmSource: "tl-newsletter" }, rules).owner, "THOUGHT_LEADER");
});
test("generic email, newsletter or campaign names remain unassigned until a rule identifies ownership", () => {
  assert.equal(resolveRegistrationAttribution({ utmSource: "newsletter", utmMedium: "email", utmCampaign: "fall" }, rules).owner, "UNASSIGNED");
  const campaignRule: AttributionRule = { id: "fall", source: "newsletter", medium: "email", campaign: "fall", owner: "ROCKET_PD" };
  assert.equal(resolveRegistrationAttribution({ utmSource: "NEWSLETTER", utmMedium: "Email", utmCampaign: "Fall" }, [campaignRule]).owner, "ROCKET_PD");
  assert.equal(resolveRegistrationAttribution({ utmSource: "newsletter", utmMedium: "email", utmCampaign: "spring" }, [campaignRule]).owner, "UNASSIGNED");
});
test("conflicting ownership rules remain unassigned instead of crediting an arbitrary team", () => {
  const value = resolveRegistrationAttribution({ utmSource: "rocketpd" }, [...rules, { id: "conflict", source: "rocketpd", medium: "", campaign: "", owner: "THOUGHT_LEADER" }]);
  assert.equal(value.owner, "UNASSIGNED"); assert.equal(value.basis, "Conflicting attribution rules");
});
test("marketing percentages include every registration and distinguish registration counts from seats", () => {
  const rows = [{ utmSource: "rocketpd" }, { utmSource: "tl-newsletter", utmMedium: "email" }, { source: "jotform" }, { utmSource: "newsletter" }].map((row, index) => ({ attribution: resolveRegistrationAttribution(row, rules), seats: index + 1, amount: 100 }));
  const summary = summarizeAttribution(rows);
  assert.equal(summary.owners.find((row) => row.owner === "ROCKET_PD")?.percentage, 25);
  assert.equal(summary.owners.find((row) => row.owner === "UNASSIGNED")?.percentage, 50);
  assert.deepEqual(summary.coverage, { tagged: 3, assigned: 2, missing: 1, conflicts: 0 });
  assert.equal(summary.totals.seats, 10); assert.equal(summarizeAttribution([]).owners[0].percentage, 0);
});
test("nested Jotform fields and tagged URLs are normalized without losing explicit source values", () => {
  const normalized = normalizeJotformRegistrationPayload({ formID: "qa-form", registration: { cohortId: "qa", primaryContactName: "QA Contact", primaryContactEmail: "qa@example.com", utmSource: "tl-newsletter", utmMedium: "email", utmCampaign: "Fall" }, organization: { name: "QA Org" } });
  assert.equal(normalized.registration.utmSource, "tl-newsletter"); assert.equal(normalized.registration.utmMedium, "email"); assert.equal(normalized.registration.utmCampaign, "Fall");
  const url = normalizeJotformRegistrationPayload({ formID: "qa", cohortId: "qa", Name: "QA Contact", Email: "qa@example.com", "Get Page URL": "https://rocketpd.com/?utm_source=rocketpd&amp;utm_medium=email&amp;utm_campaign=Fall" });
  assert.equal(url.registration.utmSource, "rocketpd"); assert.equal(url.registration.utmMedium, "email"); assert.equal(url.registration.utmCampaign, "Fall");
});
test("linked original submissions can recover attribution for reporting without mutating registrations", () => {
  const value = reportRegistrationAttribution({ source: "jotform", webhookEvents: [{ payload: { formID: "qa", cohortId: "qa", utm_source: "rocketpd", utm_medium: "email", utm_campaign: "Fall" } }] }, [], rules);
  assert.equal(value.owner, "ROCKET_PD"); assert.equal(value.campaign, "Fall");
  assert.equal(reportRegistrationAttribution({ source: "jotform", utmSource: "tl-newsletter", utmMedium: "email", webhookEvents: [{ payload: { utm_source: "rocketpd" } }] }, [], rules).owner, "THOUGHT_LEADER");
});
test("rules reject empty and duplicate matches and reject a stale revision", async () => {
  const client: any = { appSetting: { findUnique: async () => null, updateMany: async () => ({ count: 0 }), create: async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); } } };
  assert.deepEqual((await getAttributionRules(client)).rules, defaultAttributionRules);
  await assert.rejects(saveAttributionRules({ revision: null, rules: [{ id: "empty", source: "", medium: "email", campaign: "", owner: "ROCKET_PD" }] }, "qa", client), /source or a campaign/);
  await assert.rejects(saveAttributionRules({ revision: null, rules: [rules[0], { ...rules[0], id: "duplicate" }] }, "qa", client), /duplicate rules/);
  await assert.rejects(saveAttributionRules({ revision: "stale", rules }, "qa", client), /Reload before saving/);
  await assert.rejects(saveAttributionRules({ revision: null, rules }, "qa", client), /Reload before saving/);
});
test("state and attribution insights apply any selected cohort and Thought Leader, exclude cancellations, and count missing states", async () => {
  const cohortFind = prisma.cohort.findMany, mappingFind = prisma.jotformFormMapping.findMany, settingFind = prisma.appSetting.findUnique;
  let query: any;
  const registration = { status: "CONFIRMED", paymentStatus: "PAID", archivedAt: null, participantCount: 2, totalAmount: 100, organization: { name: "QA", state: "New York" }, participants: [], webhookEvents: [], utmSource: "rocketpd" };
  (prisma.cohort as any).findMany = async (input: any) => { query = input; return [{ id: "other-cohort", title: "Another Cohort", startDate: new Date("2026-04-01"), presenter: { firstName: "Maya", lastName: "Rivera" }, registrations: [registration, { ...registration, organization: { name: "Unknown" }, utmSource: null }, { ...registration, status: "CANCELLED" }, { ...registration, archivedAt: new Date() }, { ...registration, paymentStatus: "REFUNDED" }] }]; };
  (prisma.jotformFormMapping as any).findMany = async () => [];
  (prisma.appSetting as any).findUnique = async () => null;
  try {
    const report = await getCohortInsightsReport({ cohortId: "other-cohort", presenterId: "another-presenter", years: [2026], limit: 10 });
    assert.equal(query.where.id, "other-cohort"); assert.equal(query.where.presenterId, "another-presenter"); assert.ok(!JSON.stringify(query).includes("KM"));
    assert.equal(report.years[0].totals.registrations, 2); assert.equal(report.years[0].totals.missingStateRegistrations, 1); assert.equal(report.years[0].states[0].state, "NY"); assert.equal(report.years[0].states[0].percentage, 50);
    assert.equal(report.marketingAttribution.owners.find((row) => row.owner === "ROCKET_PD")?.percentage, 50);
    await assert.rejects(getCohortInsightsReport({ years: [NaN] }), /valid cohort start years/);
  } finally { prisma.cohort.findMany = cohortFind; prisma.jotformFormMapping.findMany = mappingFind; prisma.appSetting.findUnique = settingFind; }
});
