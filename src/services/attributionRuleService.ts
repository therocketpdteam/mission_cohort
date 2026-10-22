import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "./auditService";
import { defaultAttributionRules, type AttributionRule } from "@/lib/registrationAttribution";
const settingKey = "reporting.attributionRules";
const schema = z.object({ revision: z.string().nullable(), rules: z.array(z.object({ id: z.string().min(1).max(100), source: z.string().trim().max(200), medium: z.string().trim().max(200), campaign: z.string().trim().max(200), owner: z.enum(["ROCKET_PD", "THOUGHT_LEADER", "OTHER"]) }).refine((rule) => !!(rule.source || rule.campaign), "Each rule needs a source or a campaign.")).max(100) });
export async function getAttributionRules(client = prisma) {
  const row = await client.appSetting.findUnique({ where: { key: settingKey } });
  if (!row) return { revision: null as string | null, rules: defaultAttributionRules };
  return schema.parse(row.value);
}
export async function saveAttributionRules(input: unknown, actorUserId: string, client = prisma) {
  const parsed = schema.parse(input);
  const identities = parsed.rules.map((rule) => JSON.stringify([rule.source.toLowerCase(), rule.medium.toLowerCase(), rule.campaign.toLowerCase()]));
  if (new Set(identities).size !== identities.length) throw Object.assign(new Error("Combine duplicate rules before saving."), { status: 400, code: "BAD_REQUEST" });
  const next = { revision: randomUUID(), rules: parsed.rules as AttributionRule[] };
  try {
    if (parsed.revision) {
      const result = await client.appSetting.updateMany({ where: { key: settingKey, value: { path: ["revision"], equals: parsed.revision } }, data: { value: next } });
      if (!result.count) throw Object.assign(new Error("Attribution rules changed. Reload before saving."), { status: 409, code: "BAD_REQUEST" });
    } else await client.appSetting.create({ data: { key: settingKey, value: next } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw Object.assign(new Error("Attribution rules changed. Reload before saving."), { status: 409, code: "BAD_REQUEST" });
    throw error;
  }
  await logAuditEvent({ actorUserId, entityType: "AppSetting", entityId: settingKey, action: "reporting.attribution_rules_updated", description: `Updated ${next.rules.length} source attribution rules.` });
  return next;
}
