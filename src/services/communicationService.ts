import { CommunicationStatus, EmailEventType, Prisma, RecipientScope } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  communicationDraftCreateSchema,
  communicationScheduleSchema,
  communicationTemplateCreateSchema,
  communicationTemplateUpdateSchema
} from "@/validators/communication";
import { logAuditEventAsync } from "./auditService";
import { generateSessionReminderSchedule } from "@/modules/email";
import { sendEmail } from "@/services/emailService";

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

async function resolveCommunicationRecipients(communication: Awaited<ReturnType<typeof listCommunicationsByCohort>>[number]) {
  const cohort = await prisma.cohort.findUnique({
    where: { id: communication.cohortId },
    include: {
      registrations: { include: { participants: true } },
      participants: true
    }
  });

  if (!cohort) {
    return [];
  }

  if (communication.recipientScope === RecipientScope.PRIMARY_CONTACTS) {
    return cohort.registrations.map((registration) => registration.primaryContactEmail).filter(Boolean);
  }

  if (communication.recipientScope === RecipientScope.BILLING_CONTACTS) {
    return cohort.registrations.map((registration) => registration.billingContactEmail).filter(Boolean);
  }

  if (communication.recipientScope === RecipientScope.CUSTOM) {
    return Array.isArray(communication.recipientEmails)
      ? communication.recipientEmails.map((email) => String(email)).filter(Boolean)
      : [];
  }

  return cohort.participants.map((participant) => participant.email).filter(Boolean);
}

export async function sendCommunication(id: string) {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) {
    throw Object.assign(new Error("SendGrid is not configured. Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL before sending email."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const communication = await prisma.cohortCommunication.findUnique({
    where: { id },
    include: { cohort: { include: { presenter: true } }, session: true, template: true, createdBy: true }
  });

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  await prisma.cohortCommunication.update({
    where: { id },
    data: { status: CommunicationStatus.SENDING, providerError: null }
  });

  try {
    const recipients = await resolveCommunicationRecipients(communication);

    if (recipients.length === 0) {
      throw Object.assign(new Error("No recipients were resolved for this communication."), {
        code: "BAD_REQUEST",
        status: 400
      });
    }

    const result = await sendEmail({
      to: recipients,
      subject: communication.subject,
      bodyHtml: communication.bodyHtml,
      bodyText: communication.bodyText ?? undefined,
      context: {
        cohort: {
          title: communication.cohort.title,
          startDate: communication.cohort.startDate,
          presenterName: `${communication.cohort.presenter.firstName} ${communication.cohort.presenter.lastName}`
        },
        session: communication.session ?? undefined
      }
    });

    await prisma.emailEvent.createMany({
      data: recipients.map((recipientEmail) => ({
        communicationId: id,
        recipientEmail,
        provider: "sendgrid",
        providerMessageId: result.providerMessageId,
        eventType: EmailEventType.SENT
      }))
    });

    return prisma.cohortCommunication.update({
      where: { id },
      data: {
        status: CommunicationStatus.SENT,
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        providerError: null
      }
    });
  } catch (error) {
    await prisma.cohortCommunication.update({
      where: { id },
      data: {
        status: CommunicationStatus.FAILED,
        providerError: error instanceof Error ? error.message : "Unknown SendGrid error"
      }
    });
    throw error;
  }
}

export async function processScheduledCommunications(limit = 25) {
  const communications = await prisma.cohortCommunication.findMany({
    where: {
      status: CommunicationStatus.SCHEDULED,
      scheduledFor: { lte: new Date() }
    },
    orderBy: { scheduledFor: "asc" },
    take: limit
  });
  const results = [];

  for (const communication of communications) {
    try {
      results.push(await sendCommunication(communication.id));
    } catch (error) {
      results.push({ id: communication.id, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return results;
}

export async function recordSendGridEvents(events: Array<Record<string, unknown>>) {
  const records = await Promise.all(
    events.map(async (event) => {
      const providerMessageId = String(event.sg_message_id ?? event["smtp-id"] ?? "");
      const recipientEmail = String(event.email ?? "");
      const eventName = String(event.event ?? "sent").toLowerCase();
      const communication = providerMessageId
        ? await prisma.cohortCommunication.findFirst({ where: { providerMessageId } })
        : null;
      const eventTypeMap: Record<string, EmailEventType> = {
        processed: EmailEventType.SENT,
        sent: EmailEventType.SENT,
        delivered: EmailEventType.DELIVERED,
        open: EmailEventType.OPENED,
        opened: EmailEventType.OPENED,
        click: EmailEventType.CLICKED,
        clicked: EmailEventType.CLICKED,
        bounce: EmailEventType.BOUNCED,
        bounced: EmailEventType.BOUNCED,
        dropped: EmailEventType.FAILED,
        failed: EmailEventType.FAILED,
        unsubscribe: EmailEventType.UNSUBSCRIBED,
        unsubscribed: EmailEventType.UNSUBSCRIBED
      };
      const eventType = eventTypeMap[eventName] ?? EmailEventType.SENT;

      return prisma.emailEvent.create({
        data: {
          communicationId: communication?.id,
          recipientEmail,
          provider: "sendgrid",
          providerMessageId,
          eventType,
          eventPayload: event as Prisma.InputJsonValue
        }
      });
    })
  );

  return { processed: records.length };
}

export async function sendCommunicationPlaceholder(id: string) {
  return sendCommunication(id);
}

export async function markCommunicationScheduled(id: string, scheduledFor: Date) {
  return prisma.cohortCommunication.update({
    where: { id },
    data: {
      scheduledFor,
      status: CommunicationStatus.SCHEDULED
    }
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
