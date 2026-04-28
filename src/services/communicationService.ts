import { CommunicationStatus, RecipientScope } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  communicationDraftCreateSchema,
  communicationScheduleSchema,
  communicationTemplateCreateSchema,
  communicationTemplateUpdateSchema
} from "@/validators/communication";
import { logAuditEventAsync } from "./auditService";
import { generateSessionReminderSchedule } from "@/modules/email";

export async function createTemplate(input: z.input<typeof communicationTemplateCreateSchema>) {
  const data = communicationTemplateCreateSchema.parse(input);
  return prisma.communicationTemplate.create({ data });
}

export async function updateTemplate(id: string, input: z.input<typeof communicationTemplateUpdateSchema>) {
  const data = communicationTemplateUpdateSchema.parse(input);
  return prisma.communicationTemplate.update({ where: { id }, data });
}

export async function createCommunicationDraft(input: z.input<typeof communicationDraftCreateSchema>) {
  const data = communicationDraftCreateSchema.parse(input);
  return prisma.cohortCommunication.create({ data });
}

export async function scheduleCommunicationPlaceholder(input: z.input<typeof communicationScheduleSchema>) {
  const data = communicationScheduleSchema.parse(input);
  const communication = await prisma.cohortCommunication.update({
    where: { id: data.communicationId },
    data: {
      scheduledFor: data.scheduledFor,
      status: CommunicationStatus.SCHEDULED
    }
  });
  logAuditEventAsync({
    entityType: "CohortCommunication",
    entityId: communication.id,
    action: "SCHEDULED",
    description: "Communication scheduled",
    metadata: { cohortId: communication.cohortId, scheduledFor: communication.scheduledFor?.toISOString() ?? null }
  });
  return communication;
}

export async function listCommunicationsByCohort(cohortId: string) {
  return prisma.cohortCommunication.findMany({
    where: { cohortId },
    orderBy: { createdAt: "desc" },
    include: { template: true, session: true, createdBy: true }
  });
}

export async function listTemplates() {
  return prisma.communicationTemplate.findMany({
    orderBy: { name: "asc" }
  });
}

export async function createPlannedSessionReminders(sessionId: string, createdById: string) {
  const session = await prisma.cohortSession.findUnique({
    where: { id: sessionId },
    include: { cohort: true }
  });

  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const schedule = generateSessionReminderSchedule(session);
  const records = await Promise.all(
    schedule.map((item) =>
      prisma.cohortCommunication.create({
        data: {
          cohortId: session.cohortId,
          sessionId: session.id,
          subject: `${session.title} reminder`,
          bodyHtml: `<p>Reminder for {{session.title}} in ${session.cohort.title}.</p>`,
          bodyText: `Reminder for {{session.title}} in ${session.cohort.title}.`,
          scheduledFor: item.scheduledFor,
          status: CommunicationStatus.SCHEDULED,
          recipientScope: RecipientScope.ALL_PARTICIPANTS,
          createdById
        }
      })
    )
  );

  for (const record of records) {
    logAuditEventAsync({
      entityType: "CohortCommunication",
      entityId: record.id,
      action: "SCHEDULED",
      description: "Session reminder scheduled",
      metadata: { sessionId, scheduledFor: record.scheduledFor?.toISOString() ?? null }
    });
  }

  return records;
}
