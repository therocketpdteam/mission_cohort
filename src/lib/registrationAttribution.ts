export type AttributionOwner = "ROCKET_PD" | "THOUGHT_LEADER" | "OTHER" | "UNASSIGNED";
export type AttributionRule = { id: string; source: string; medium: string; campaign: string; owner: Exclude<AttributionOwner, "UNASSIGNED"> };
export const attributionOwners: Record<AttributionOwner, string> = { ROCKET_PD: "RocketPD marketing", THOUGHT_LEADER: "Thought Leader marketing", OTHER: "Other identified source", UNASSIGNED: "Unassigned / unknown" };
export const defaultAttributionRules: AttributionRule[] = ["rocketpd", "rocket_pd", "rocket-pd"].map((source) => ({ id: source, source, medium: "", campaign: "", owner: "ROCKET_PD" }));
export type AttributionInput = { source?: string | null; externalSource?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; utmContent?: string | null; utmTerm?: string | null; landingPageUrl?: string | null; referrerUrl?: string | null };
const text = (value?: string | null) => String(value ?? "").trim();
const key = (value: string) => value.trim().toLowerCase();
const intakeNames = new Set(["jotform", "jotform_api", "webhook", "registration_form", "manual", "admin", "import", "csv"]);
export function urlAttribution(url?: string | null) {
  try {
    const parsed = new URL(text(url).replace(/&amp;/gi, "&"));
    if (!["https:", "http:"].includes(parsed.protocol)) return {};
    const params = new Map([...parsed.searchParams].map(([name, value]) => [name.toLowerCase(), value.trim()]));
    return Object.fromEntries(["Source", "Medium", "Campaign", "Content", "Term"].map((name) => [`utm${name}`, params.get(`utm_${name.toLowerCase()}`) || ""]));
  } catch { return {}; }
}
export function resolveRegistrationAttribution(input: AttributionInput, rules: AttributionRule[] = defaultAttributionRules) {
  const landing = urlAttribution(input.landingPageUrl), referrer = urlAttribution(input.referrerUrl);
  const value = (field: keyof AttributionInput) => text(input[field]) || text(landing[field]) || text(referrer[field]);
  const recorded = text(input.source);
  const source = value("utmSource") || (recorded && !intakeNames.has(key(recorded)) ? recorded : "");
  const medium = value("utmMedium"), campaign = value("utmCampaign");
  const matches = rules.filter((rule) => (rule.source || rule.campaign) && (!rule.source || key(rule.source) === key(source)) && (!rule.medium || key(rule.medium) === key(medium)) && (!rule.campaign || key(rule.campaign) === key(campaign)));
  const owners = new Set(matches.map((rule) => rule.owner));
  const owner: AttributionOwner = owners.size === 1 ? [...owners][0] : "UNASSIGNED";
  let referrerHost = "";
  try { referrerHost = new URL(text(input.referrerUrl)).hostname; } catch {}
  const tagged = !!(source || medium || campaign);
  const basis = owners.size > 1 ? "Conflicting attribution rules" : text(input.utmSource) || text(input.utmCampaign) || text(input.utmMedium) ? "Captured UTM fields" : Object.values(landing).some(Boolean) || Object.values(referrer).some(Boolean) ? "Tagged URL" : source ? "Recorded source" : referrerHost ? "Referrer only; campaign unknown" : "No marketing source captured";
  return { source, medium, campaign, content: value("utmContent"), term: value("utmTerm"), intake: text(input.externalSource) || (intakeNames.has(key(recorded)) ? recorded : ""), owner, ownerLabel: attributionOwners[owner], tagged, basis, referrerHost,
    label: [source, medium, campaign].filter(Boolean).join(" · ") || "Unknown marketing source" };
}
export type ResolvedAttribution = ReturnType<typeof resolveRegistrationAttribution>;
export function summarizeAttribution(rows: Array<{ attribution: ResolvedAttribution; seats: number; amount: number }>) {
  const total = rows.length;
  const totals = { registrations: total, seats: rows.reduce((sum, row) => sum + row.seats, 0), amount: rows.reduce((sum, row) => sum + row.amount, 0) };
  const percent = (count: number) => total ? Math.round(count / total * 1000) / 10 : 0;
  const owners = (Object.keys(attributionOwners) as AttributionOwner[]).map((owner) => {
    const matches = rows.filter((row) => row.attribution.owner === owner);
    return { owner, label: attributionOwners[owner], registrations: matches.length, percentage: percent(matches.length), seats: matches.reduce((sum, row) => sum + row.seats, 0), amount: matches.reduce((sum, row) => sum + row.amount, 0) };
  });
  const sources = new Map<string, { label: string; source: string; medium: string; campaign: string; ownerLabel: string; registrations: number; seats: number; amount: number; basis: string }>();
  for (const row of rows) {
    const a = row.attribution;
    const identity = JSON.stringify([key(a.source), key(a.medium), key(a.campaign), a.owner, a.basis]);
    const group = sources.get(identity) ?? { label: a.label, source: a.source, medium: a.medium, campaign: a.campaign, ownerLabel: a.ownerLabel, registrations: 0, seats: 0, amount: 0, basis: a.basis };
    group.registrations++; group.seats += row.seats; group.amount += row.amount; sources.set(identity, group);
  }
  return { totals, owners, sources: [...sources.values()].map((row) => ({ ...row, percentage: percent(row.registrations) })).sort((a, b) => b.registrations - a.registrations),
    coverage: { tagged: rows.filter((row) => row.attribution.tagged).length, assigned: rows.filter((row) => row.attribution.owner !== "UNASSIGNED").length, missing: rows.filter((row) => !row.attribution.tagged).length, conflicts: rows.filter((row) => row.attribution.basis === "Conflicting attribution rules").length },
    methodology: "Shares use all active, non-cancelled, non-refunded registrations in this report, including unknown sources. One registration may contain multiple seats. Attribution follows captured source tags and the configured ownership rules; it does not establish that marketing caused a registration. Jotform identifies the intake tool, not a marketing channel." };
}
