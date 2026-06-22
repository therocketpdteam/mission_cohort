import {
  CohortStatus,
  CommunicationStatus,
  ParticipantStatus,
  RecipientScope,
  RegistrationStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCalendarInvitePlaceholder } from "./calendarService";
import { ensureDefaultCommunicationTemplates, getSystemUserId, sendCommunication } from "./communicationService";

const journeyTemplateNames = {
  pocConfirmation: "POC Registration Confirmation",
  participantConfirmation: "Participant Registration Confirmation",
  monthBefore: "One Month Before Cohort",
  weekBefore: "One Week Before Cohort"
} as const;

type JourneyTemplateName = (typeof journeyTemplateNames)[keyof typeof journeyTemplateNames];

export type RegistrationMilestone = {
  key: "month-before" | "week-before";
  templateName: JourneyTemplateName;
  scheduledFor: Date;
  eligible: boolean;
};

export function buildRegistrationMilestones(firstSessionStart: Date | string, now = new Date()): RegistrationMilestone[] {
  const start = new Date(firstSessionStart);
  const rows = [
    {
      key: "month-before" as const,
      templateName: journeyTemplateNames.monthBefore,
      scheduledFor: new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000)
    },
    {
      key: "week-before" as const,
      templateName: journeyTemplateNames.weekBefore,
      scheduledFor: new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
  ];

  return rows.map((row) => ({ ...row, eligible: row.scheduledFor.getTime() > now.getTime() }));
}

const cancellableJourneyStatuses = [
  CommunicationStatus.DRAFT,
  CommunicationStatus.SCHEDULED,
  CommunicationStatus.FAILED
];

export async function cancelRegistrationJourneys(registrationId: string, reason: string) {
  return prisma.cohortCommunication.updateMany({
    where: {
      registrationId,
      journeyKey: { not: null },
      status: { in: cancellableJourneyStatuses }
    },
    data: { status: CommunicationStatus.CANCELLED, providerError: reason }
  });
}

export async function cancelParticipantJourneys(participantIds: string[], reason: string) {
  if (participantIds.length === 0) {
    return { count: 0 };
  }
  return prisma.cohortCommunication.updateMany({
    where: {
      participantId: { in: participantIds },
      journeyKey: { not: null },
      status: { in: cancellableJourneyStatuses }
    },
    data: { status: CommunicationStatus.CANCELLED, providerError: reason }
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function deliveryAuthorized(status: CohortStatus) {
  return status === CohortStatus.PUBLISHED || status === CohortStatus.ACTIVE;
}

async function upsertJourneyCommunication(input: {
  journeyKey: string;
  cohortId: string;
  registrationId: string;
  participantId?: string;
  template: { id: string; subject: string; bodyHtml: string; bodyText: string | null };
  recipientEmail: string;
  scheduledFor?: Date;
  status: CommunicationStatus;
  skippedReason?: string;
}) {
  const existing = await prisma.cohortCommunication.findUnique({ where: { journeyKey: input.journeyKey } });

  if (existing?.status === CommunicationStatus.SENT || existing?.status === CommunicationStatus.FAILED) {
    return existing;
  }

  const data = {
    cohortId: input.cohortId,
    registrationId: input.registrationId,
    participantId: input.participantId,
    templateId: input.template.id,
    subject: input.template.subject,
    bodyHtml: input.template.bodyHtml,
    bodyText: input.template.bodyText,
    scheduledFor: input.scheduledFor,
    status: input.status,
    recipientScope: RecipientScope.CUSTOM,
    recipientEmails: [normalizeEmail(input.recipientEmail)],
    providerError: input.skippedReason ?? null
  };

  if (existing) {
    return prisma.cohortCommunication.update({ where: { id: existing.id }, data });
  }

  return prisma.cohortCommunication.create({
    data: {
      ...data,
      journeyKey: input.journeyKey,
      createdById: await getSystemUserId()
    }
  });
}

async function attachRegistrationDocuments(communicationId: string, registration: {
  id: string;
  w9Url: string | null;
  invoiceUrl: string | null;
  invoiceDrafts: Array<{
    invoiceNumber: string | null;
    pdfFileKey: string | null;
    pdfUrl: string | null;
  }>;
}) {
  const invoice = registration.invoiceDrafts.find((item) => item.pdfFileKey && item.pdfUrl);
  const documents = [
    registration.w9Url
      ? { fileName: "RocketPD W-9", fileKey: `registration/${registration.id}/w9`, url: registration.w9Url, provider: "external" }
      : null,
    invoice
      ? {
          fileName: `Invoice ${invoice.invoiceNumber ?? registration.id}.pdf`,
          fileKey: invoice.pdfFileKey!,
          url: invoice.pdfUrl!,
          provider: "supabase"
        }
      : registration.invoiceUrl
        ? { fileName: "Registration invoice", fileKey: `registration/${registration.id}/invoice`, url: registration.invoiceUrl, provider: "external" }
        : null
  ].filter((document): document is { fileName: string; fileKey: string; url: string; provider: string } => Boolean(document));

  for (const document of documents) {
    const existing = await prisma.communicationAttachment.findFirst({
      where: { communicationId, fileKey: document.fileKey }
    });
    if (!existing) {
      await prisma.communicationAttachment.create({
        data: {
          communicationId,
          fileName: document.fileName,
          contentType: "application/pdf",
          provider: document.provider,
          fileKey: document.fileKey,
          url: document.url
        }
      });
    }
  }

  return documents.length;
}

async function syncFutureCalendarInvites(registration: {
  cohort: { status: CohortStatus; sessions: Array<{ id: string; startTime: Date; calendarEvents: Array<{ provider: string; providerEventId: string | null }> }> };
}) {
  if (!deliveryAuthorized(registration.cohort.status)) {
    return { updated: 0, status: "waiting_for_publish" as const };
  }

  const futureLinkedSessions = registration.cohort.sessions.filter((session) =>
    session.startTime.getTime() > Date.now() && session.calendarEvents.some((event) => event.provider === "google" && event.providerEventId)
  );
  let updated = 0;

  for (const session of futureLinkedSessions) {
    await createCalendarInvitePlaceholder(session.id, "google");
    updated += 1;
  }

  return { updated, status: "synced" as const };
}

export async function planRegistrationJourneys(
  registrationId: string,
  options: { syncCalendar?: boolean } = {}
) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      organization: true,
      participants: { where: { status: ParticipantStatus.REGISTERED } },
      invoiceDrafts: { orderBy: { updatedAt: "desc" } },
      cohort: {
        include: {
          sessions: {
            orderBy: { startTime: "asc" },
            include: { calendarEvents: { where: { provider: "google" } } }
          }
        }
      }
    }
  });

  if (!registration || registration.archivedAt || registration.status === RegistrationStatus.CANCELLED) {
    return { registrationId, planned: 0, sent: 0, skipped: 0, ignored: true };
  }

  const templates = await ensureDefaultCommunicationTemplates();
  const byName = new Map(templates.map((template) => [template.name, template]));
  const template = (name: JourneyTemplateName) => {
    const found = byName.get(name);
    if (!found) {
      throw Object.assign(new Error(`${name} template is unavailable.`), { code: "NOT_FOUND", status: 404 });
    }
    return found;
  };
  const planned = [];
  const immediate = [];
  const pocEmail = normalizeEmail(registration.primaryContactEmail);
  const poc = await upsertJourneyCommunication({
    journeyKey: `registration:${registration.id}:poc:${pocEmail}:confirmation`,
    cohortId: registration.cohortId,
    registrationId: registration.id,
    template: template(journeyTemplateNames.pocConfirmation),
    recipientEmail: pocEmail,
    status: CommunicationStatus.DRAFT
  });
  const attachmentCount = await attachRegistrationDocuments(poc.id, registration);
  planned.push(poc);
  immediate.push(poc);

  const firstSession = registration.cohort.sessions[0];
  const milestones = firstSession ? buildRegistrationMilestones(firstSession.startTime) : [];

  for (const participant of registration.participants) {
    const email = normalizeEmail(participant.email);
    const confirmation = await upsertJourneyCommunication({
      journeyKey: `registration:${registration.id}:participant:${email}:confirmation`,
      cohortId: registration.cohortId,
      registrationId: registration.id,
      participantId: participant.id,
      template: template(journeyTemplateNames.participantConfirmation),
      recipientEmail: email,
      status: CommunicationStatus.DRAFT
    });
    planned.push(confirmation);
    immediate.push(confirmation);

    for (const milestone of milestones) {
      planned.push(await upsertJourneyCommunication({
        journeyKey: `registration:${registration.id}:participant:${email}:${milestone.key}`,
        cohortId: registration.cohortId,
        registrationId: registration.id,
        participantId: participant.id,
        template: template(milestone.templateName),
        recipientEmail: email,
        scheduledFor: milestone.scheduledFor,
        status: milestone.eligible ? CommunicationStatus.SCHEDULED : CommunicationStatus.SKIPPED,
        skippedReason: milestone.eligible ? undefined : "Skipped because this participant was registered after the milestone date."
      }));
    }
  }

  const sent = [];
  if (deliveryAuthorized(registration.cohort.status)) {
    for (const communication of immediate) {
      if (communication.status === CommunicationStatus.DRAFT) {
        try {
          sent.push(await sendCommunication(communication.id));
        } catch {
          // The failed communication remains visible and retryable in Communications.
        }
      }
    }
  }

  if (sent.some((communication) => communication.id === poc.id) && attachmentCount > 0) {
    await prisma.registration.update({ where: { id: registration.id }, data: { confirmationDocsSentAt: new Date() } });
  }

  let calendar: Awaited<ReturnType<typeof syncFutureCalendarInvites>> = {
    updated: 0,
    status: "waiting_for_publish" as const
  };
  if (options.syncCalendar !== false) {
    try {
      calendar = await syncFutureCalendarInvites(registration);
    } catch (error) {
      console.warn("Registration calendar enrollment failed", error);
    }
  }

  return {
    registrationId,
    planned: planned.length,
    sent: sent.length,
    skipped: planned.filter((communication) => communication.status === CommunicationStatus.SKIPPED).length,
    calendar
  };
}

export async function activateCohortRegistrationJourneys(cohortId: string) {
  const registrations = await prisma.registration.findMany({
    where: { cohortId, archivedAt: null, status: { not: RegistrationStatus.CANCELLED } },
    select: { id: true }
  });
  const results = [];

  for (const registration of registrations) {
    results.push(await planRegistrationJourneys(registration.id, { syncCalendar: false }));
  }

  return { cohortId, registrations: results.length, results };
}
