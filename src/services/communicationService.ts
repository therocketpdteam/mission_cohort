import { CohortStatus, CommunicationStatus, EmailEventType, OperationsTaskCategory, OperationsTaskStatus, ParticipantStatus, Prisma, RecipientScope, RegistrationStatus, Role, TemplateType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMissingEmailReviewColumn, migrationRequiredResult } from "@/lib/prismaCompatibility";
import {
  communicationDraftCreateSchema,
  communicationScheduleSchema,
  communicationTemplateCreateSchema,
  communicationTemplateUpdateSchema
} from "@/validators/communication";
import { logAuditEventAsync } from "./auditService";
import { generateSessionReminderSchedule, textToEmailHtml } from "@/modules/email";
import { sendEmail } from "@/services/emailService";
import { deletePrivateAppFile } from "@/services/storageService";
import { assertCohortDeliveryAllowed, getSendGridSetup } from "@/services/integrationSetupService";

type DefaultTemplate = {
  type: TemplateType;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

function defaultEmailTemplate(template: Omit<DefaultTemplate, "bodyHtml"> & { bodyHtml?: string }): DefaultTemplate {
  return {
    ...template,
    bodyHtml: template.bodyHtml ?? textToEmailHtml(template.bodyText)
  };
}

const defaultTemplates: DefaultTemplate[] = [
  defaultEmailTemplate({
    type: TemplateType.REGISTRATION_CONFIRMATION,
    name: "Registration Confirmation",
    subject: "Registration confirmation: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

Thank you for signing up for **{{cohort.title}}** with {{cohort.presenterName}}.

This email confirms your initial registration in the live-virtual cohort experience.

If you registered a team or group, someone from RocketPD will reach out shortly to confirm participant names and emails and to make sure calendar invitations and session links are set up correctly.

If you requested a purchase order, a RocketPD team member will help make sure you have the information and forms needed for purchase and accounting.

As we get closer to launch, you and any registered team members can expect:

- Calendar invites to the sessions, including sign-in links
- A kickoff email at least one week before the first session
- Reminder emails before each session
- Periodic thought-leader resources, recordings, and next steps
- A post-event email with follow-up information and a survey
- Certificates of completion when requested by your school or district in advance

Thank you again for registering. We can’t wait to get started.

Questions at any time? Reply to this message or contact info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.WEEK_BEFORE_REMINDER,
    name: "1 Week Before Session",
    subject: "One week reminder: {{session.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you are registered for **{{session.title}}** in RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

The session is coming up on {{session.startTime}}.

[Join the session]({{session.meetingUrl}})

A few important notes:

- Please use the Zoom link in this email or in your calendar invitation.
- The meeting room will open about 10 minutes before the session begins.
- Live attendance is encouraged, and recordings/resources will be shared when available.
- If you have questions about the portal, recordings, certificates, or the cohort experience, email info@rocketpd.com.

We look forward to learning alongside you.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.DAY_BEFORE_REMINDER,
    name: "24 Hours Before Session",
    subject: "Reminder: {{cohort.title}} session is live tomorrow",
    bodyText: `Hello {{participant.firstName}},

This is a quick reminder that **{{session.title}}** for **{{cohort.title}}**, with {{cohort.presenterName}}, is tomorrow at {{session.startTime}}.

Please see your calendar invitation or use the link below to sign in. The meeting room will be open 10 minutes before the session begins.

[Join the session]({{session.meetingUrl}})

Questions or trouble signing in? Email info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.HOUR_BEFORE_REMINDER,
    name: "60 Minutes Before Session",
    subject: "60 minutes away: {{cohort.title}}",
    bodyText: `Hi {{participant.firstName}},

{{cohort.presenterName}} is excited to begin **{{session.title}}** in about one hour.

Please use the link below or the one in your calendar invitation to join.

[Join the session]({{session.meetingUrl}})

If you have questions or run into any issues, contact us at (855) 757-6253 or info@rocketpd.com.

{{cohort.presenterName}} is looking forward to seeing you there.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.FOLLOW_UP,
    name: "24 Hours Post Session",
    subject: "Follow-up: {{session.title}}",
    bodyText: `Hi {{participant.firstName}},

What a great session yesterday.

As promised, we’re sharing resources for **{{session.title}}** in **{{cohort.title}}**.

[Access the cohort resources]({{session.resourcesUrl}})

Recordings are typically uploaded to the RocketPD Learning Portal within 24 hours after each scheduled session and remain available for up to 30 days after the final session.

If this is your first time logging in, you may be asked to create a password. Your username is the email address used for your registration.

Your experience is everything to us. If you have questions about resources, recordings, the learning community, or anything inside your RocketPD portal, please reach out to info@rocketpd.com.

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.PAYMENT_REMINDER,
    name: "Payment Reminder",
    subject: "Payment reminder: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

This is a friendly reminder about payment for **{{cohort.title}}**.

Current payment status: **{{registration.paymentStatus}}**
Invoice number: {{registration.invoiceNumber}}

[View the invoice]({{registration.invoiceUrl}})

If your organization requires a purchase order, W-9, or any additional accounting documentation, reply to this email and we’ll help right away.

[Here is your W-9 for your convenience]({{registration.w9Url}})

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Participant List Request",
    subject: "Participant list needed: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

Hope you are well.

We are excited to have {{organization.name}} as part of **{{cohort.title}}**.

You registered more than one person for this cohort, and we still need the participant names and work email addresses so every participant receives calendar invitations, meeting links, reminders, and resources.

Please reply with each participant on a separate line, like this:

- First Last, email@school.org
- First Last, email@school.org

You can also reply with an Excel file if that is easier.

We will not share these names or email addresses outside RocketPD without permission.

Questions? Reply here or contact info@rocketpd.com.

Kind regards,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Supporting Documents Request",
    subject: "Supporting documents needed: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

We are preparing **{{cohort.title}}** for {{organization.name}} and want to make sure purchasing/accounting has what it needs.

Available documents:

- [Here is your W-9 for your convenience]({{registration.w9Url}})
- [Here is your invoice]({{registration.invoiceUrl}})

If you need a PO number added, a revised invoice date, updated participant count, or any other adjustment, reply directly to this message and we’ll take care of it.

Thank you,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Cohort Cancellation",
    subject: "Cancelled: {{cohort.title}}",
    bodyText: `Hello,

The remaining sessions for **{{cohort.title}}** have been cancelled.

Google Calendar invitations have been removed. Please contact the RocketPD team at info@rocketpd.com if you have any questions or need support.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Session Cancellation",
    subject: "Cancelled: {{session.title}} | {{cohort.title}}",
    bodyText: `Hello,

**{{session.title}}** for **{{cohort.title}}** has been cancelled.

The Google Calendar invitation has been removed. Please contact the RocketPD team at info@rocketpd.com if you have any questions.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Session Updated",
    subject: "Updated: {{session.title}} | {{cohort.title}}",
    bodyText: `Hello,

**{{session.title}}** for **{{cohort.title}}** has been updated.

The session is now scheduled for {{session.startTime}}. Your Google Calendar invitation has also been updated.

Please contact the RocketPD team at info@rocketpd.com if you have any questions.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "POC Registration Confirmation",
    subject: "Registration received: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

Hope you are well.

We received the registration for **{{organization.name}}** in **{{cohort.title}}** with {{cohort.presenterName}}.

Registration summary:

- Participants registered: {{registration.participantCount}}
- Payment status: {{registration.paymentStatus}}
- Invoice number: {{registration.invoiceNumber}}

Available documents:

- [Here is your W-9 for your convenience]({{registration.w9Url}})
- [Here is your invoice]({{registration.invoiceUrl}})

If you registered a team and already shared participant information, we are reviewing it and will let you know if we have questions.

If you registered a team and have not shared participant information yet, please reply with each participant’s name and work email address so we can send calendar invitations, meeting links, reminders, and resources.

Thank you again for signing up for this cohort. We’re looking forward to a great experience.

Kind regards,
The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Participant Registration Confirmation",
    subject: "You're registered: {{cohort.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you, or someone on your team, registered you to participate in RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

We couldn’t be more excited to start this journey with you.

You will receive calendar invitations and meeting links at this email address, plus reminder emails as each session approaches.

What to expect:

- Calendar invitations for each live session
- A kickoff email before the first session
- Reminder emails before each session
- Resources and recordings when available
- A feedback survey and certificate information after the cohort

Questions? Email info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "One Month Before Cohort",
    subject: "Getting ready for {{cohort.title}} with {{cohort.presenterName}}",
    bodyText: `Hello {{participant.firstName}},

Thank you again for registering for **{{cohort.title}}** with {{cohort.presenterName}}.

As a reminder, your first session starts on {{session.startTime}}.

You will receive calendar invitations with links to access each session, along with reminder emails before each session.

Want to start your learning early? Here are three simple steps:

- Review the cohort description and goals.
- Watch for any RocketPD resources shared before kickoff.
- Make sure the calendar invitations are visible on your calendar.

Expect more information and resources from us one week before the first live cohort session.

If you have questions about registration, billing, the schedule, content, or the learning experience, contact us at info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "One Week Before Cohort",
    subject: "Kick-off: {{cohort.title}}",
    bodyText: `Hello {{participant.firstName}},

You’re receiving this because you, or someone on your team, registered you for RocketPD’s **{{cohort.title}}** cohort with {{cohort.presenterName}}.

We couldn’t be more excited to start this journey with you.

As a reminder, the first session kicks off on {{session.startTime}}.

[Here is your sign-in link]({{session.meetingUrl}})

How to prepare:

- Review your calendar invitation and make sure the session link is available.
- Join a few minutes early so we can help with any access issues.
- Watch for portal/resource information from RocketPD as the cohort begins.

Recordings:

Live attendance is encouraged. When recordings are available, they are typically posted within 24 hours after the live session and remain available for a limited time after the cohort concludes.

Certificates:

If certificates are part of your cohort experience, you will receive survey/certificate instructions after completion.

Questions about the portal, recordings, certificates, or the cohort experience? Email info@rocketpd.com.

Can’t wait to learn alongside you.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Registration Changes Summary",
    subject: "Registration updates: {{cohort.title}}",
    bodyText: `Hello {{registration.primaryContactName}},

The requested registration updates have been applied for **{{cohort.title}}**.

If this update affected participants, calendar invitations and participant communications will reflect the updated roster.

If this update affected billing, your invoice/receipt information will be updated as needed.

Questions? Reply to this message or contact info@rocketpd.com.

The RocketPD Team`
  }),
  defaultEmailTemplate({
    type: TemplateType.CUSTOM,
    name: "Post Cohort Feedback",
    subject: "{{participant.firstName}}, share your feedback and receive your certificate",
    bodyText: `Hello {{participant.firstName}},

This is Corey, one of the co-founders at RocketPD.

Recently, you participated in **{{cohort.title}}** with {{cohort.presenterName}}. As a condition of your participation, you may be eligible for a custom certificate of completion that you can share with your administration for professional development hours or units.

To obtain your certificate, please complete the brief learning survey linked below. Once complete, your certificate will be sent to the email address we have on file.

[Yes, take the survey](https://rocketpd.com/survey)

Why a survey?

We have one goal at RocketPD: to support educators everywhere through high-quality professional learning. Your voice is one of the most important ways we improve the experience for educators like you.

As a reminder, cohort recordings and resources are available for a limited time after the final session.

If you do not receive your certificate, cannot find it, or need support, email info@rocketpd.com and someone will help.

Thank you,
The RocketPD Team`
  })
];

const sessionTemplateTypes = [
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

const recipientIssueTypes = new Set<EmailEventType>([EmailEventType.BOUNCED, EmailEventType.FAILED]);

type EventSummaryInput = {
  id?: string;
  eventType: EmailEventType;
  recipientEmail?: string;
  createdAt: Date;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
  reviewNote?: string | null;
};

type LegacyEmailEventRow = EventSummaryInput & {
  communicationId: string | null;
  provider: string;
  providerMessageId: string | null;
  eventPayload: Prisma.JsonValue | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailEventSummary(events: EventSummaryInput[]) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
    return acc;
  }, {});
  const latest = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const issueEvents = events.filter((event) => recipientIssueTypes.has(event.eventType));
  const unreviewedIssueEvents = issueEvents.filter((event) => !event.reviewedAt);

  return {
    lastEmailEvent: latest?.eventType ?? null,
    lastEmailEventAt: latest?.createdAt ?? null,
    sentCount: counts.SENT ?? 0,
    deliveredCount: counts.DELIVERED ?? 0,
    openedCount: counts.OPENED ?? 0,
    clickedCount: counts.CLICKED ?? 0,
    bouncedCount: counts.BOUNCED ?? 0,
    failedCount: counts.FAILED ?? 0,
    unsubscribedCount: counts.UNSUBSCRIBED ?? 0,
    issueCount: issueEvents.length,
    unreviewedIssueCount: unreviewedIssueEvents.length,
    reviewedIssueCount: issueEvents.length - unreviewedIssueEvents.length
  };
}

export function buildRecipientDeliveryRows(events: EventSummaryInput[], relatedByEmail: Map<string, unknown> = new Map()) {
  const grouped = new Map<string, EventSummaryInput[]>();

  for (const event of events) {
    const key = normalizeEmail(event.recipientEmail ?? "");
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return Array.from(grouped.entries())
    .map(([email, recipientEvents]) => {
      const sortedEvents = [...recipientEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const issueEvents = sortedEvents.filter((event) => recipientIssueTypes.has(event.eventType));
      const unreviewedIssueEvents = issueEvents.filter((event) => !event.reviewedAt);
      return {
        id: email,
        recipientEmail: email,
        events: sortedEvents,
        latestEvent: sortedEvents[0]?.eventType ?? null,
        latestEventAt: sortedEvents[0]?.createdAt ?? null,
        issueEvents,
        unreviewedIssueEvents,
        needsReview: unreviewedIssueEvents.length > 0,
        emailSummary: emailEventSummary(sortedEvents),
        related: relatedByEmail.get(email) ?? null
      };
    })
    .sort((a, b) => {
      if (a.needsReview !== b.needsReview) {
        return a.needsReview ? -1 : 1;
      }
      return new Date(b.latestEventAt ?? 0).getTime() - new Date(a.latestEventAt ?? 0).getTime();
    });
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

export async function addCommunicationAttachment(input: {
  communicationId?: string;
  templateId?: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  provider?: string;
  fileKey: string;
  url?: string;
}) {
  return prisma.communicationAttachment.create({
    data: {
      communicationId: input.communicationId,
      templateId: input.templateId,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSize: input.fileSize,
      provider: input.provider,
      fileKey: input.fileKey,
      url: input.url
    }
  });
}

function resourceAttachmentUrl(resource: { url?: string | null; muxPlaybackId?: string | null }) {
  if (resource.url) {
    return resource.url;
  }

  if (resource.muxPlaybackId) {
    return `https://stream.mux.com/${resource.muxPlaybackId}`;
  }

  return null;
}

export async function attachResourceToCommunication(input: { communicationId: string; resourceId: string }) {
  const [communication, resource] = await Promise.all([
    prisma.cohortCommunication.findUnique({ where: { id: input.communicationId } }),
    prisma.cohortResource.findUnique({ where: { id: input.resourceId }, include: { session: true } })
  ]);

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (!resource) {
    throw Object.assign(new Error("Material not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (resource.cohortId !== communication.cohortId) {
    throw Object.assign(new Error("Material must belong to the same cohort as this communication."), { code: "BAD_REQUEST", status: 400 });
  }

  if (communication.sessionId && resource.sessionId && resource.sessionId !== communication.sessionId) {
    throw Object.assign(new Error("Session material must belong to this communication's session."), { code: "BAD_REQUEST", status: 400 });
  }

  const fileKey = resource.fileKey || `resource:${resource.id}`;
  const existing = await prisma.communicationAttachment.findFirst({
    where: {
      communicationId: input.communicationId,
      fileKey
    }
  });

  if (existing) {
    return existing;
  }

  return addCommunicationAttachment({
    communicationId: input.communicationId,
    fileName: resource.session ? `${resource.session.sessionNumber}. ${resource.title}` : resource.title,
    contentType: resource.type,
    provider: resource.provider || "resource",
    fileKey,
    url: resourceAttachmentUrl(resource) ?? undefined
  });
}

export async function removeCommunicationAttachment(id: string) {
  const attachment = await prisma.communicationAttachment.findUnique({ where: { id } });

  if (!attachment) {
    throw Object.assign(new Error("Attachment not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (attachment.fileKey && attachment.provider === "supabase" && !attachment.fileKey.startsWith("resource:")) {
    await deletePrivateAppFile(attachment.fileKey).catch(() => null);
  }

  return prisma.communicationAttachment.delete({ where: { id } });
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

async function buildRelatedRecipientMap(emails: string[]) {
  const normalizedEmails = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  const map = new Map<string, unknown>();

  if (normalizedEmails.length === 0) {
    return map;
  }

  const emailOr = normalizedEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }));
  const registrationOr = normalizedEmails.flatMap((email) => [
    { primaryContactEmail: { equals: email, mode: "insensitive" as const } },
    { billingContactEmail: { equals: email, mode: "insensitive" as const } }
  ]);

  const [participants, registrations] = await Promise.all([
    prisma.participant.findMany({
      where: { OR: emailOr },
      include: { cohort: true, organization: true, registration: true }
    }),
    prisma.registration.findMany({
      where: { OR: registrationOr },
      include: { cohort: true, organization: true }
    })
  ]);

  for (const registration of registrations) {
    for (const email of [registration.primaryContactEmail, registration.billingContactEmail].map((value) => normalizeEmail(value ?? ""))) {
      if (!email || map.has(email)) {
        continue;
      }
      map.set(email, {
        kind: "registration",
        registrationId: registration.id,
        registrationHref: `/registrations?search=${encodeURIComponent(email)}`,
        participantHref: null,
        displayName: registration.primaryContactName,
        organizationName: registration.organization?.name,
        cohortTitle: registration.cohort?.title
      });
    }
  }

  for (const participant of participants) {
    const email = normalizeEmail(participant.email);
    map.set(email, {
      kind: "participant",
      participantId: participant.id,
      registrationId: participant.registrationId,
      participantHref: `/participants?search=${encodeURIComponent(email)}`,
      registrationHref: `/registrations?search=${encodeURIComponent(email)}`,
      displayName: `${participant.firstName} ${participant.lastName}`.trim(),
      organizationName: participant.organization?.name,
      cohortTitle: participant.cohort?.title
    });
  }

  return map;
}

async function enrichCommunications(communications: Array<any>) {
  const emails = communications.flatMap((communication) => communication.emailEvents.map((event: EventSummaryInput) => event.recipientEmail ?? ""));
  const relatedByEmail = await buildRelatedRecipientMap(emails);

  return communications.map((communication) => {
    const recipientRows = buildRecipientDeliveryRows(communication.emailEvents, relatedByEmail);
    const issueRows = recipientRows
      .filter((recipient) => recipient.needsReview)
      .map((recipient) => ({
        id: `${communication.id}:${recipient.recipientEmail}`,
        communicationId: communication.id,
        subject: communication.subject,
        status: communication.status,
        cohort: communication.cohort,
        session: communication.session,
        template: communication.template,
        attachments: communication.attachments,
        recipientEmail: recipient.recipientEmail,
        latestEvent: recipient.latestEvent,
        latestEventAt: recipient.latestEventAt,
        issueEvents: recipient.unreviewedIssueEvents,
        emailSummary: recipient.emailSummary,
        related: recipient.related
      }));

    return {
      ...communication,
      recipientRows,
      issueRows,
      emailSummary: emailEventSummary(communication.emailEvents)
    };
  });
}

async function legacyEmailEventsForCommunicationIds(communicationIds: string[]) {
  if (communicationIds.length === 0) {
    return [];
  }

  return prisma.$queryRaw<LegacyEmailEventRow[]>`
    SELECT id, "communicationId", "recipientEmail", provider, "providerMessageId", "eventType", "eventPayload", "createdAt"
    FROM "EmailEvent"
    WHERE "communicationId" IN (${Prisma.join(communicationIds)})
    ORDER BY "createdAt" DESC
  `;
}

async function legacyEmailEventsForRecipient(email: string) {
  return prisma.$queryRaw<LegacyEmailEventRow[]>`
    SELECT id, "communicationId", "recipientEmail", provider, "providerMessageId", "eventType", "eventPayload", "createdAt"
    FROM "EmailEvent"
    WHERE lower("recipientEmail") = lower(${email})
    ORDER BY "createdAt" DESC
  `;
}

async function listCommunicationsLegacy(input: { cohortId?: string | null; limit?: number; issueOnly?: boolean } = {}) {
  const take = Math.min(Math.max(Number(input.limit ?? 100), 1), 250);
  const communications = await prisma.cohortCommunication.findMany({
    where: input.cohortId ? { cohortId: input.cohortId } : {},
    orderBy: { createdAt: "desc" },
    take,
    include: { cohort: true, template: true, session: true, createdBy: true, attachments: true }
  });
  const events = await legacyEmailEventsForCommunicationIds(communications.map((communication) => communication.id));
  const eventsByCommunication = new Map<string, LegacyEmailEventRow[]>();

  for (const event of events) {
    if (!event.communicationId) {
      continue;
    }
    eventsByCommunication.set(event.communicationId, [...(eventsByCommunication.get(event.communicationId) ?? []), event]);
  }

  const enriched = await enrichCommunications(communications.map((communication) => ({
    ...communication,
    emailEvents: eventsByCommunication.get(communication.id) ?? []
  })));

  return input.issueOnly ? enriched.filter((communication) => communication.issueRows.length > 0) : enriched;
}

export async function listCommunications(input: { cohortId?: string | null; limit?: number; issueOnly?: boolean } = {}) {
  const take = Math.min(Math.max(Number(input.limit ?? 100), 1), 250);
  try {
    const communications = await prisma.cohortCommunication.findMany({
      where: {
        ...(input.cohortId ? { cohortId: input.cohortId } : {}),
        ...(input.issueOnly
          ? { emailEvents: { some: { eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] }, reviewedAt: null } } }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take,
      include: { cohort: true, template: true, session: true, createdBy: true, emailEvents: { include: { reviewedBy: true }, orderBy: { createdAt: "desc" } }, attachments: true }
    });

    return enrichCommunications(communications);
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    return listCommunicationsLegacy(input);
  }
}

export async function listCommunicationsByCohort(cohortId: string) {
  return listCommunications({ cohortId });
}

export async function listUnreviewedCommunicationIssues(input: { cohortId?: string | null; limit?: number } = {}) {
  const communications = await listCommunications({ ...input, issueOnly: true });
  return communications.flatMap((communication) => communication.issueRows).slice(0, input.limit ?? 100);
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
      registrations: { where: { archivedAt: null }, include: { participants: true } },
      participants: {
        where: {
          status: ParticipantStatus.REGISTERED,
          registration: { archivedAt: null, status: { not: RegistrationStatus.CANCELLED } }
        }
      }
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
  const communication = await prisma.cohortCommunication.findUnique({
    where: { id },
    include: {
      cohort: { include: { presenter: true } },
      session: true,
      registration: { include: { organization: true, invoiceDrafts: { orderBy: { updatedAt: "desc" } } } },
      participant: true,
      template: true,
      createdBy: true,
      attachments: true
    }
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

    await assertCohortDeliveryAllowed("SENDGRID", communication.cohort.status, recipients);

    const result = await sendEmail({
      to: recipients,
      subject: communication.subject,
      bodyHtml: communication.bodyHtml,
      bodyText: communication.bodyText ?? undefined,
      attachments: communication.attachments,
      context: options?.context ?? {
        cohort: {
          title: communication.cohort.title,
          description: communication.cohort.description,
          startDate: communication.cohort.startDate,
          presenterName: `${communication.cohort.presenter.firstName} ${communication.cohort.presenter.lastName}`
        },
        session: communication.session ?? undefined,
        participant: communication.participant ?? undefined,
        registration: communication.registration ?? undefined,
        organization: communication.registration?.organization ?? undefined
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

export async function sendCommunicationToRecipient(input: { communicationId: string; recipientEmail: string }) {
  const recipientEmail = input.recipientEmail.trim();

  if (!recipientEmail) {
    throw Object.assign(new Error("recipientEmail is required"), { code: "BAD_REQUEST", status: 400 });
  }

  return sendCommunication(input.communicationId, { recipients: [recipientEmail] });
}

export async function cancelCommunication(input: { id: string }) {
  const communication = await prisma.cohortCommunication.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, sentAt: true }
  });

  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (communication.sentAt || communication.status === CommunicationStatus.SENT || communication.status === CommunicationStatus.SENDING) {
    throw Object.assign(new Error("Sent or sending communications cannot be cancelled from the journey."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return prisma.cohortCommunication.update({
    where: { id: input.id },
    data: {
      status: CommunicationStatus.CANCELLED,
      scheduledFor: null,
      providerError: null
    }
  });
}

export async function sendCalendarCancellationNotice(input: { cohortId: string; sessionId?: string }) {
  await ensureDefaultCommunicationTemplates();
  const templateName = input.sessionId ? "Session Cancellation" : "Cohort Cancellation";
  const template = await prisma.communicationTemplate.findFirst({
    where: { name: templateName, type: TemplateType.CUSTOM, active: true }
  });

  if (!template) {
    throw Object.assign(new Error(`${templateName} template is unavailable.`), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: template.id,
    cohortId: input.cohortId,
    sessionId: input.sessionId,
    recipientScope: RecipientScope.ALL_PARTICIPANTS
  });

  return sendCommunication(communication.id);
}

export async function sendCalendarUpdateNotice(input: { cohortId: string; sessionId: string }) {
  await ensureDefaultCommunicationTemplates();
  const template = await prisma.communicationTemplate.findFirst({
    where: { name: "Session Updated", type: TemplateType.CUSTOM, active: true }
  });

  if (!template) {
    throw Object.assign(new Error("Session Updated template is unavailable."), { code: "NOT_FOUND", status: 404 });
  }

  const communication = await createCommunicationFromTemplate({
    templateId: template.id,
    cohortId: input.cohortId,
    sessionId: input.sessionId,
    recipientScope: RecipientScope.ALL_PARTICIPANTS
  });

  return sendCommunication(communication.id);
}

type SessionScheduleChange = {
  sessionId: string;
  sessionNumber?: number | null;
  title: string;
  timezone: string;
  previousStartTime: Date | string;
  nextStartTime: Date | string;
  previousEndTime: Date | string;
  nextEndTime: Date | string;
};

function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatScheduleTime(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

export async function sendCohortScheduleChangeNotice(input: { cohortId: string; changes: SessionScheduleChange[] }) {
  if (input.changes.length === 0) {
    return null;
  }

  const cohort = await prisma.cohort.findUnique({ where: { id: input.cohortId } });
  if (!cohort) {
    throw Object.assign(new Error("Cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  const rows = input.changes.map((change) => {
    const label = `${change.sessionNumber ? `Session ${change.sessionNumber}: ` : ""}${change.title}`;
    const previous = `${formatScheduleTime(change.previousStartTime, change.timezone)} - ${formatScheduleTime(change.previousEndTime, change.timezone)}`;
    const next = `${formatScheduleTime(change.nextStartTime, change.timezone)} - ${formatScheduleTime(change.nextEndTime, change.timezone)}`;
    const scheduleChanged = new Date(change.previousStartTime).getTime() !== new Date(change.nextStartTime).getTime() ||
      new Date(change.previousEndTime).getTime() !== new Date(change.nextEndTime).getTime();
    return { label, previous, next, scheduleChanged };
  });
  const bodyHtml = [
    `<p>The schedule for <strong>${escapeEmailHtml(cohort.title)}</strong> has been updated.</p>`,
    "<p>Your calendar invitations have been updated. The affected sessions are:</p>",
    `<ul>${rows.map((row) => row.scheduleChanged
      ? `<li><strong>${escapeEmailHtml(row.label)}</strong><br>Previous: ${escapeEmailHtml(row.previous)}<br>New: ${escapeEmailHtml(row.next)}</li>`
      : `<li><strong>${escapeEmailHtml(row.label)}</strong><br>Session details were updated in the calendar invitation.</li>`).join("")}</ul>`,
    "<p>Please contact the RocketPD team if you have any questions.</p>"
  ].join("");
  const bodyText = [
    `The schedule for ${cohort.title} has been updated.`,
    "Your calendar invitations have been updated.",
    ...rows.map((row) => row.scheduleChanged
      ? `${row.label}\nPrevious: ${row.previous}\nNew: ${row.next}`
      : `${row.label}\nSession details were updated in the calendar invitation.`),
    "Please contact the RocketPD team if you have any questions."
  ].join("\n\n");
  const createdById = await getSystemUserId();
  const communication = await prisma.cohortCommunication.create({
    data: {
      cohortId: input.cohortId,
      subject: `Schedule updated: ${cohort.title}`,
      bodyHtml,
      bodyText,
      status: CommunicationStatus.DRAFT,
      recipientScope: RecipientScope.ALL_PARTICIPANTS,
      createdById
    }
  });

  return sendCommunication(communication.id);
}

export async function reviewRecipientIssue(input: { communicationId: string; recipientEmail: string; reviewedById: string; reviewNote?: string }) {
  const recipientEmail = input.recipientEmail.trim();

  if (!recipientEmail) {
    throw Object.assign(new Error("recipientEmail is required"), { code: "BAD_REQUEST", status: 400 });
  }

  try {
    const updated = await prisma.emailEvent.updateMany({
      where: {
        communicationId: input.communicationId,
        recipientEmail: { equals: recipientEmail, mode: "insensitive" },
        eventType: { in: [EmailEventType.BOUNCED, EmailEventType.FAILED] },
        reviewedAt: null
      },
      data: {
        reviewedAt: new Date(),
        reviewedById: input.reviewedById,
        reviewNote: input.reviewNote
      }
    });

    return { reviewed: updated.count };
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    return migrationRequiredResult("Communications issue review");
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
    include: { cohort: { include: { presenter: true } }, organization: true, registration: { include: { invoiceDrafts: { orderBy: { updatedAt: "desc" } } } } }
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
          description: participant.cohort.description,
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
    where: { id: { in: input.registrationIds }, archivedAt: null },
    include: { cohort: { include: { presenter: true } }, organization: true, invoiceDrafts: { orderBy: { updatedAt: "desc" } } }
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
          description: registration.cohort.description,
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

  await prisma.operationsTask.updateMany({
    where: {
      sessionId,
      category: OperationsTaskCategory.REMINDER_EMAILS,
      status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
    },
    data: { status: OperationsTaskStatus.COMPLETED, completedAt: new Date() }
  });

  return records;
}

function scheduledTimeForSessionTemplate(type: TemplateType, startTime: Date) {
  if (type === TemplateType.WEEK_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (type === TemplateType.DAY_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
  }
  if (type === TemplateType.HOUR_BEFORE_REMINDER) {
    return new Date(startTime.getTime() - 60 * 60 * 1000);
  }
  if (type === TemplateType.FOLLOW_UP) {
    return new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

export async function rescheduleUnsentSessionCommunications(sessionId: string, startTime: Date) {
  const communications = await prisma.cohortCommunication.findMany({
    where: {
      sessionId,
      status: CommunicationStatus.SCHEDULED,
      sentAt: null,
      template: {
        type: {
          in: [
            TemplateType.WEEK_BEFORE_REMINDER,
            TemplateType.DAY_BEFORE_REMINDER,
            TemplateType.HOUR_BEFORE_REMINDER,
            TemplateType.FOLLOW_UP
          ]
        }
      }
    },
    include: { template: true }
  });

  const updates = communications.flatMap((communication) => {
    const scheduledFor = communication.template ? scheduledTimeForSessionTemplate(communication.template.type, startTime) : null;
    return scheduledFor ? [{ id: communication.id, scheduledFor }] : [];
  });

  await prisma.$transaction(
    updates.map((update) => prisma.cohortCommunication.update({
      where: { id: update.id },
      data: { scheduledFor: update.scheduledFor }
    }))
  );

  return { updated: updates.length };
}

export async function createDefaultCohortSessionCommunications(cohortId: string) {
  const sessions = await prisma.cohortSession.findMany({
    where: { cohortId },
    orderBy: { sessionNumber: "asc" }
  });
  const results = [];

  for (const session of sessions) {
    const created = await createDefaultSessionCommunications(session.id);
    results.push({
      sessionId: session.id,
      sessionTitle: session.title,
      created: created.length
    });
  }

  return {
    cohortId,
    total: sessions.length,
    created: results.reduce((sum, result) => sum + result.created, 0),
    results
  };
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

export async function getRecipientCommunicationThread(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  let events: any[];
  let communications: any[];

  try {
    [events, communications] = await Promise.all([
      prisma.emailEvent.findMany({
        where: { recipientEmail: { equals: normalized, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        include: { reviewedBy: true, communication: { include: { cohort: true, session: true, template: true, attachments: true } } }
      }),
      prisma.cohortCommunication.findMany({
        where: {
          OR: [
            { recipientEmails: { array_contains: [email] } },
            { recipientEmails: { array_contains: [normalized] } }
          ]
        },
        orderBy: { createdAt: "desc" },
        include: { cohort: true, session: true, template: true, emailEvents: { include: { reviewedBy: true } }, attachments: true }
      })
    ]);
  } catch (error) {
    if (!isMissingEmailReviewColumn(error)) {
      throw error;
    }

    const legacyEvents = await legacyEmailEventsForRecipient(normalized);
    communications = await prisma.cohortCommunication.findMany({
      where: {
        OR: [
          { recipientEmails: { array_contains: [email] } },
          { recipientEmails: { array_contains: [normalized] } },
          { id: { in: legacyEvents.map((event) => event.communicationId).filter((id): id is string => Boolean(id)) } }
        ]
      },
      orderBy: { createdAt: "desc" },
      include: { cohort: true, session: true, template: true, attachments: true }
    });
    events = legacyEvents.map((event) => ({
      ...event,
      communication: communications.find((communication) => communication.id === event.communicationId) ?? null
    }));
    communications = communications.map((communication) => ({
      ...communication,
      emailEvents: legacyEvents.filter((event) => event.communicationId === communication.id)
    }));
  }

  const byCommunication = new Map<string, any>();

  for (const communication of communications) {
    byCommunication.set(communication.id, {
      ...communication,
      recipientEmail: normalized,
      events: communication.emailEvents.filter((event: EventSummaryInput) => normalizeEmail(event.recipientEmail ?? "") === normalized),
      emailSummary: emailEventSummary(communication.emailEvents.filter((event: EventSummaryInput) => normalizeEmail(event.recipientEmail ?? "") === normalized))
    });
  }

  for (const event of events) {
    if (event.communication) {
      const existing = byCommunication.get(event.communication.id);
      const nextEvents = [...(existing?.events ?? []), event];
      byCommunication.set(event.communication.id, {
        ...event.communication,
        recipientEmail: normalized,
        events: nextEvents,
        emailSummary: emailEventSummary(nextEvents)
      });
    } else {
      const eventId = event.id ?? `${normalized}-${event.createdAt?.toISOString?.() ?? "event"}`;
      byCommunication.set(eventId, {
        id: eventId,
        subject: "Provider event",
        status: event.eventType,
        recipientEmail: normalized,
        createdAt: event.createdAt,
        events: [event],
        attachments: [],
        emailSummary: emailEventSummary([event])
      });
    }
  }

  return Array.from(byCommunication.values()).sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime());
}

export async function processScheduledCommunications(limit = 25) {
  const setup = await getSendGridSetup();
  const communications = await prisma.cohortCommunication.findMany({
    where: {
      status: CommunicationStatus.SCHEDULED,
      scheduledFor: { lte: new Date() },
      ...(setup.liveSendingEnabled ? { cohort: { status: { not: CohortStatus.DRAFT } } } : {})
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
