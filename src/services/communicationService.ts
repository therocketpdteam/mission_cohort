import { CommunicationStatus, EmailEventType, Prisma, RecipientScope, Role, TemplateType } from "@prisma/client";
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

const defaultTemplates: Array<{
  type: TemplateType;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}> = [
  {
    type: TemplateType.REGISTRATION_CONFIRMATION,
    name: "Registration Confirmation",
    subject: "Registration confirmation: {{cohort.title}}",
    bodyHtml: "<p>Hello {{registration.primaryContactName}},</p><p>Your registration for <strong>{{cohort.title}}</strong> has been received.</p>",
    bodyText: "Hello {{registration.primaryContactName}}, your registration for {{cohort.title}} has been received."
  },
  {
    type: TemplateType.WEEK_BEFORE_REMINDER,
    name: "1 Week Before Session",
    subject: "One week reminder: {{session.title}}",
    bodyHtml: "<p>Hello {{participant.firstName}},</p><p>{{session.title}} for {{cohort.title}} is coming up in one week.</p>",
    bodyText: "Hello {{participant.firstName}}, {{session.title}} for {{cohort.title}} is coming up in one week."
  },
  {
    type: TemplateType.DAY_BEFORE_REMINDER,
    name: "24 Hours Before Session",
    subject: "Tomorrow: {{session.title}}",
    bodyHtml: "<p>Hello {{participant.firstName}},</p><p>This is your 24-hour reminder for {{session.title}}.</p>",
    bodyText: "Hello {{participant.firstName}}, this is your 24-hour reminder for {{session.title}}."
  },
  {
    type: TemplateType.HOUR_BEFORE_REMINDER,
    name: "60 Minutes Before Session",
    subject: "Starting soon: {{session.title}}",
    bodyHtml: "<p>Hello {{participant.firstName}},</p><p>{{session.title}} starts in about 60 minutes.</p>",
    bodyText: "Hello {{participant.firstName}}, {{session.title}} starts in about 60 minutes."
  },
  {
    type: TemplateType.FOLLOW_UP,
    name: "24 Hours Post Session",
    subject: "Follow-up: {{session.title}}",
    bodyHtml: "<p>Hello {{participant.firstName}},</p><p>Thank you for attending {{session.title}}. Resources and next steps will be shared here.</p>",
    bodyText: "Hello {{participant.firstName}}, thank you for attending {{session.title}}. Resources and next steps will be shared here."
  },
  {
    type: TemplateType.PAYMENT_REMINDER,
    name: "Payment Reminder",
    subject: "Payment reminder: {{cohort.title}}",
    bodyHtml: "<p>Hello {{registration.primaryContactName}},</p><p>This is a friendly reminder about payment status for {{cohort.title}}.</p>",
    bodyText: "Hello {{registration.primaryContactName}}, this is a friendly reminder about payment status for {{cohort.title}}."
  }
];

const sessionTemplateTypes = [
  TemplateType.REGISTRATION_CONFIRMATION,
  TemplateType.WEEK_BEFORE_REMINDER,
  TemplateType.DAY_BEFORE_REMINDER,
  TemplateType.HOUR_BEFORE_REMINDER,
  TemplateType.FOLLOW_UP
] as const;

export async function getSystemUserId() {
  const user = await prisma.user.upsert({
    where: { email: "system@mission-control.local" },
    update: { active: true },
    create: {
      email: "system@mission-control.local",
      firstName: "Mission",
      lastName: "Control",
      role: Role.SUPER_ADMIN,
      active: true
    }
  });

  return user.id;
}

export async function ensureDefaultCommunicationTemplates() {
  const templates = [];

  for (const template of defaultTemplates) {
    const existing = await prisma.communicationTemplate.findFirst({ where: { type: template.type, name: template.name } });
    templates.push(
      existing
        ? await prisma.communicationTemplate.update({
            where: { id: existing.id },
            data: { active: existing.active, subject: existing.subject || template.subject, bodyHtml: existing.bodyHtml || template.bodyHtml, bodyText: existing.bodyText || template.bodyText }
          })
        : await prisma.communicationTemplate.create({ data: { ...template, active: true } })
    );
  }

  return templates;
}

function emailEventSummary(events: Array<{ eventType: EmailEventType; createdAt: Date }>) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
    return acc;
  }, {});
  const latest = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return {
    lastEmailEvent: latest?.eventType ?? null,
    lastEmailEventAt: latest?.createdAt ?? null,
    sentCount: counts.SENT ?? 0,
    deliveredCount: counts.DELIVERED ?? 0,
    openedCount: counts.OPENED ?? 0,
    bouncedCount: counts.BOUNCED ?? 0,
    failedCount: counts.FAILED ?? 0,
    unsubscribedCount: counts.UNSUBSCRIBED ?? 0
  };
}

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
  const communications = await prisma.cohortCommunication.findMany({
    where: { cohortId },
    orderBy: { createdAt: "desc" },
    include: { template: true, session: true, createdBy: true, emailEvents: true }
  });

  return communications.map((communication) => ({
    ...communication,
    emailSummary: emailEventSummary(communication.emailEvents)
  }));
}

function emailValues(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value?.trim()));
}

async function resolveCommunicationRecipients(communication: {
  cohortId: string;
  recipientScope: RecipientScope;
  recipientEmails: Prisma.JsonValue | null;
}): Promise<string[]> {
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
    return emailValues(cohort.registrations.map((registration) => registration.primaryContactEmail));
  }

  if (communication.recipientScope === RecipientScope.BILLING_CONTACTS) {
    return emailValues(cohort.registrations.map((registration) => registration.billingContactEmail));
  }

  if (communication.recipientScope === RecipientScope.CUSTOM) {
    return Array.isArray(communication.recipientEmails)
      ? emailValues(communication.recipientEmails.map((email) => typeof email === "string" ? email : ""))
      : [];
  }

  return emailValues(cohort.participants.map((participant) => participant.email));
}

export async function sendCommunication(id: string, options?: { recipients?: string[]; context?: Parameters<typeof sendEmail>[0]["context"] }) {
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
    const recipients = options?.recipients ?? await resolveCommunicationRecipients(communication);

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
      context: options?.context ?? {
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

async function createCommunicationFromTemplate(input: {
  templateId: string;
  cohortId: string;
  sessionId?: string;
  recipientScope: RecipientScope;
  recipientEmails?: string[];
  scheduledFor?: Date;
}) {
  const template = await prisma.communicationTemplate.findUnique({ where: { id: input.templateId } });

  if (!template) {
    throw Object.assign(new Error("Communication template not found"), { code: "NOT_FOUND", status: 404 });
  }

  const createdById = await getSystemUserId();

  return prisma.cohortCommunication.create({
    data: {
      cohortId: input.cohortId,
      sessionId: input.sessionId,
      templateId: template.id,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      scheduledFor: input.scheduledFor,
      status: input.scheduledFor ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT,
      recipientScope: input.recipientScope,
      recipientEmails: input.recipientEmails,
      createdById
    }
  });
}

export async function sendTemplateToParticipant(input: { templateId: string; participantId: string }) {
  const participant = await prisma.participant.findUnique({
    where: { id: input.participantId },
    include: { cohort: { include: { presenter: true } }, organization: true, registration: true }
  });

  if (!participant) {
    throw Object.assign(new Error("Participant not found"), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: input.templateId,
    cohortId: participant.cohortId,
    recipientScope: RecipientScope.CUSTOM,
    recipientEmails: [participant.email]
  });

  return sendCommunication(communication.id, {
    recipients: [participant.email],
    context: {
      cohort: {
        title: participant.cohort.title,
        startDate: participant.cohort.startDate,
        presenterName: `${participant.cohort.presenter.firstName} ${participant.cohort.presenter.lastName}`
      },
      participant,
      organization: participant.organization,
      registration: participant.registration
    }
  });
}

export async function sendTemplateToRegistrations(input: { templateId: string; registrationIds: string[] }) {
  const registrations = await prisma.registration.findMany({
    where: { id: { in: input.registrationIds } },
    include: { cohort: { include: { presenter: true } }, organization: true }
  });
  const results = [];

  for (const registration of registrations) {
    const communication = await createCommunicationFromTemplate({
      templateId: input.templateId,
      cohortId: registration.cohortId,
      recipientScope: RecipientScope.CUSTOM,
      recipientEmails: [registration.primaryContactEmail]
    });
    results.push(await sendCommunication(communication.id, {
      recipients: [registration.primaryContactEmail],
      context: {
        cohort: {
          title: registration.cohort.title,
          startDate: registration.cohort.startDate,
          presenterName: `${registration.cohort.presenter.firstName} ${registration.cohort.presenter.lastName}`
        },
        organization: registration.organization,
        registration
      }
    }));
  }

  return results;
}

export async function createDefaultSessionCommunications(sessionId: string) {
  const session = await prisma.cohortSession.findUnique({ where: { id: sessionId }, include: { cohort: true } });

  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const templates = await ensureDefaultCommunicationTemplates();
  const createdById = await getSystemUserId();
  const existing = await prisma.cohortCommunication.findMany({
    where: {
      sessionId,
      template: { type: { in: [...sessionTemplateTypes] } }
    },
    include: { template: true }
  });
  const existingTypes = new Set(existing.map((communication) => communication.template?.type).filter(Boolean));
  const records = [];

  for (const template of templates.filter((item) => sessionTemplateTypes.includes(item.type as (typeof sessionTemplateTypes)[number]))) {
    if (existingTypes.has(template.type)) {
      continue;
    }

    const start = new Date(session.startTime);
    const scheduledFor =
      template.type === TemplateType.WEEK_BEFORE_REMINDER
        ? new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
        : template.type === TemplateType.DAY_BEFORE_REMINDER
          ? new Date(start.getTime() - 24 * 60 * 60 * 1000)
          : template.type === TemplateType.HOUR_BEFORE_REMINDER
            ? new Date(start.getTime() - 60 * 60 * 1000)
            : template.type === TemplateType.FOLLOW_UP
              ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
              : undefined;

    records.push(await prisma.cohortCommunication.create({
      data: {
        cohortId: session.cohortId,
        sessionId,
        templateId: template.id,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
        scheduledFor,
        status: scheduledFor ? CommunicationStatus.SCHEDULED : CommunicationStatus.DRAFT,
        recipientScope: template.type === TemplateType.REGISTRATION_CONFIRMATION ? RecipientScope.PRIMARY_CONTACTS : RecipientScope.ALL_PARTICIPANTS,
        createdById
      }
    }));
  }

  return records;
}

export async function getRecipientCommunicationSummary(emails: string[]) {
  const normalizedEmails = emails.map((email) => email.toLowerCase()).filter(Boolean);
  const events = await prisma.emailEvent.findMany({
    where: { recipientEmail: { in: normalizedEmails } },
    orderBy: { createdAt: "desc" }
  });
  const grouped = new Map<string, typeof events>();

  for (const event of events) {
    const key = event.recipientEmail.toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return Object.fromEntries(normalizedEmails.map((email) => [email, emailEventSummary(grouped.get(email) ?? [])]));
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
  await ensureDefaultCommunicationTemplates();

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
  const resolvedCreatedById = createdById || (await getSystemUserId());
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
          createdById: resolvedCreatedById
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
