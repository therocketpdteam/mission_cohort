import { randomUUID } from "node:crypto";
import { CommunicationStatus, Prisma, RecipientScope } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseSupportJourneyKey, supportJourneyKey, supportJourneyPrefix, supportReminderKinds, supportReminderTemplate, supportReminderTime } from "@/modules/email/supportReminders";
import { logAuditEventAsync } from "./auditService";

type Client = Prisma.TransactionClient;
const memberSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()) });
const membersSchema = z.array(memberSchema).max(50).superRefine((members, context) => {
  if (new Set(members.map((member) => member.email)).size !== members.length) {
    context.addIssue({ code: "custom", message: "Each support email can be assigned only once per cohort." });
  }
});
const storedSchema = z.object({ revision: z.string().uuid(), updatedById: z.string().min(1), members: membersSchema, calendarHistoryEmails: z.array(z.string().email()).default([]) });
export const supportTeamUpdateSchema = z.object({
  revision: z.string().uuid().nullable(),
  members: z.array(memberSchema.omit({ id: true }).extend({ id: z.string().uuid().optional() })).max(50)
});
const settingKey = (cohortId: string) => `cohort.supportTeam.${cohortId}`;
const pendingStatuses = [CommunicationStatus.DRAFT, CommunicationStatus.SCHEDULED, CommunicationStatus.SKIPPED, CommunicationStatus.FAILED];

function conflict() {
  return Object.assign(new Error("The support team changed since you opened it. Reload the team before saving."), { code: "CONFLICT", status: 409 });
}

export async function readCohortSupportTeam(cohortId: string, client: Client = prisma) {
  const setting = await client.appSetting.findUnique({ where: { key: settingKey(cohortId) } });
  return setting ? storedSchema.parse(setting.value) : null;
}

export async function getCohortSupportTeam(cohortId: string, client: Client = prisma) {
  const cohort = await client.cohort.findUnique({ where: { id: cohortId }, select: { id: true } });
  if (!cohort) throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  const team = await readCohortSupportTeam(cohortId, client);
  const reminders = await client.cohortCommunication.findMany({
    where: { cohortId, journeyKey: { startsWith: supportJourneyPrefix(cohortId) } },
    select: { id: true, journeyKey: true, status: true, scheduledFor: true, sentAt: true, providerError: true, recipientEmails: true, sessionId: true },
    orderBy: { scheduledFor: "asc" }
  });
  return { revision: team?.revision ?? null, members: team?.members ?? [], reminders: reminders.map(({ journeyKey, ...reminder }) => ({ ...reminder, kind: parseSupportJourneyKey(journeyKey)?.kind })) };
}

// Cohort-specific settings use the existing AppSetting store, like the invoice
// profile. No registration records or database schema changes are needed.
export async function reconcileCohortSupportReminders(cohortId: string, client: Client = prisma, now = new Date()) {
  const team = await readCohortSupportTeam(cohortId, client);
  if (!team) return { scheduled: 0 };
  const cohort = await client.cohort.findUnique({ where: { id: cohortId }, include: { sessions: true } });
  if (!cohort) return { scheduled: 0 };
  const existing = await client.cohortCommunication.findMany({ where: { cohortId, journeyKey: { startsWith: supportJourneyPrefix(cohortId) } } });
  const byKey = new Map(existing.map((record) => [record.journeyKey, record]));
  const desiredKeys: string[] = [];
  let scheduled = 0;
  for (const member of team.members) {
    for (const session of cohort.sessions.filter((session) => session.startTime > now)) {
      for (const kind of supportReminderKinds) {
        const journeyKey = supportJourneyKey(cohortId, member.id, session.id, kind);
        desiredKeys.push(journeyKey);
        const previous = byKey.get(journeyKey);
        if (previous && (previous.sentAt || ["SENT", "SENDING", "CANCELLED", "FAILED"].includes(previous.status))) continue;
        const scheduledFor = supportReminderTime(session.startTime, kind);
        // A new assignment never triggers a retrospective reminder. Existing
        // due messages stay queued for their normal worker to deliver.
        const missed = scheduledFor <= now && (!previous || previous.status !== CommunicationStatus.SCHEDULED || previous.scheduledFor?.getTime() !== scheduledFor.getTime());
        const status = cohort.status === "CANCELLED" || cohort.status === "COMPLETED" ? CommunicationStatus.CANCELLED
          : missed ? CommunicationStatus.SKIPPED
            : cohort.status === "PUBLISHED" ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT;
        const data = {
          ...supportReminderTemplate(kind), scheduledFor, status,
          recipientScope: RecipientScope.CUSTOM, recipientEmails: [member.email],
          providerError: missed ? "Reminder time passed before this support assignment or schedule was saved." : null
        };
        await client.cohortCommunication.upsert({
          where: { journeyKey },
          create: { ...data, cohortId, sessionId: session.id, journeyKey, createdById: team.updatedById },
          // Sent and in-flight records must never be revived by a concurrent
          // reconciliation. Updates use a conditional write below instead.
          update: {}
        });
        if (previous) await client.cohortCommunication.updateMany({
          where: { id: previous.id, sentAt: null, status: { in: [CommunicationStatus.DRAFT, CommunicationStatus.SCHEDULED, CommunicationStatus.SKIPPED] } }, data
        });
        if (status === CommunicationStatus.SCHEDULED) scheduled += 1;
      }
    }
  }
  await client.cohortCommunication.updateMany({
    where: { cohortId, journeyKey: { startsWith: supportJourneyPrefix(cohortId), notIn: desiredKeys }, sentAt: null, status: { in: pendingStatuses } },
    data: { status: CommunicationStatus.CANCELLED, providerError: "Support assignment removed or session no longer upcoming." }
  });
  return { scheduled };
}

export async function saveCohortSupportTeam(cohortId: string, input: unknown, updatedById: string, options: { client?: typeof prisma; now?: Date; audit?: typeof logAuditEventAsync } = {}) {
  const { client = prisma, now = new Date(), audit = logAuditEventAsync } = options;
  const parsed = supportTeamUpdateSchema.parse(input);
  try {
    await client.$transaction(async (tx) => {
      const cohort = await tx.cohort.findUnique({ where: { id: cohortId }, select: { id: true, status: true } });
      if (!cohort) throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
      const previous = await readCohortSupportTeam(cohortId, tx);
      if ((previous?.revision ?? null) !== parsed.revision) throw conflict();
      const members = membersSchema.parse(parsed.members.map((member) => {
        const old = previous?.members.find((item) => item.id === member.id);
        if (member.id && !old) throw conflict();
        // A changed email is a new delivery assignment. Never transfer sent
        // history or a queued message to a different person.
        return { ...member, id: old?.email === member.email ? old.id : randomUUID() };
      }));
      const value = { revision: randomUUID(), updatedById, members, calendarHistoryEmails: [...new Set([...(previous?.calendarHistoryEmails ?? []), ...(previous?.members ?? []).map((member) => member.email), ...members.map((member) => member.email)])] };
      if (previous) {
        const updated = await tx.appSetting.updateMany({
          where: { key: settingKey(cohortId), value: { path: ["revision"], equals: previous.revision } },
          data: { value }
        });
        if (updated.count !== 1) throw conflict();
      } else {
        await tx.appSetting.create({ data: { key: settingKey(cohortId), value } });
      }
      await reconcileCohortSupportReminders(cohortId, tx, now);
    }, { timeout: 30_000 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw conflict();
    throw error;
  }
  audit({ actorUserId: updatedById, entityType: "Cohort", entityId: cohortId, action: "SUPPORT_TEAM_UPDATED", description: "Cohort support team updated", metadata: { supportPeople: parsed.members.length } });
  return getCohortSupportTeam(cohortId, client);
}
