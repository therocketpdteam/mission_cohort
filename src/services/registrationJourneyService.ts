import {
  CohortStatus,
  CommunicationStatus,
  EmailEventType,
  InvoiceDraftStatus,
  OperationsTaskCategory,
  OperationsTaskPriority,
  OperationsTaskStatus,
  ParticipantStatus,
  RecipientScope,
  RegistrationStatus,
  SupportingDocumentStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCalendarInvitePlaceholder } from "./calendarService";
import { generateSessionIcs } from "@/modules/calendar";
import { ensureDefaultCommunicationTemplates, getSystemUserId, sendCommunication } from "./communicationService";
import { sendEmail } from "./emailService";
import { getOrganizationInvoiceProfile } from "./appSettingsService";
import { registrationConfirmationDocumentReadiness } from "./registrationDocumentReadiness";
import { createInvoiceDraft, generateInvoicePdf } from "./invoiceService";
import {
  createQuickBooksInvoiceFromDraft,
  getQuickBooksAutomationReadiness,
  registrationRequiresQuickBooksInvoice,
  shouldAutoSyncRegistrationInvoiceToQuickBooks
} from "./quickBooksService";

const journeyTemplateNames = {
  pocConfirmation: "POC Registration Confirmation",
  participantConfirmation: "Participant Registration Confirmation",
  threeWeeksBefore: "Three Weeks Before Cohort",
  weekBefore: "One Week Before Cohort"
} as const;

type JourneyTemplateName = (typeof journeyTemplateNames)[keyof typeof journeyTemplateNames];
type RegistrationForPocDocuments = {
  id: string;
  cohortId: string;
  organizationId: string;
  paymentMethod: string;
  totalAmount: unknown;
  w9Url: string | null;
  invoiceUrl: string | null;
  quickBooksInvoiceRef?: string | null;
  invoiceDrafts: Array<{
    id: string;
    status?: InvoiceDraftStatus | string | null;
    invoiceNumber: string | null;
    pdfFileKey: string | null;
    pdfUrl: string | null;
    quickBooksInvoiceRef?: string | null;
  }>;
};

export type RegistrationMilestone = {
  key: "three-weeks-before" | "week-before";
  templateName: JourneyTemplateName;
  scheduledFor: Date;
  eligible: boolean;
};

export function buildRegistrationMilestones(firstSessionStart: Date | string, now = new Date()): RegistrationMilestone[] {
  const start = new Date(firstSessionStart);
  const rows = [
    {
      key: "three-weeks-before" as const,
      templateName: journeyTemplateNames.threeWeeksBefore,
      scheduledFor: new Date(start.getTime() - 21 * 24 * 60 * 60 * 1000)
    },
    {
      key: "week-before" as const,
      templateName: journeyTemplateNames.weekBefore,
      scheduledFor: new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
  ];

  return rows.map((row) => ({ ...row, eligible: row.scheduledFor.getTime() > now.getTime() }));
}

export function participantConfirmationJourneyKey(input: {
  registrationId: string;
  participantEmail: string;
  cohortId?: string;
  batchKey?: string;
}) {
  const base = `registration:${input.registrationId}:participant:${normalizeEmail(input.participantEmail)}:confirmation`;
  const cohortSegment = input.cohortId ? `:cohort:${input.cohortId}` : "";
  const batchSegment = input.batchKey ? `:batch:${input.batchKey}` : "";

  return `${base}${cohortSegment}${batchSegment}`;
}

export function shouldAutoPrepareRegistrationInvoice(registration: {
  paymentMethod?: string | null;
  totalAmount?: unknown;
  invoiceUrl?: string | null;
  invoiceDrafts?: Array<{ pdfUrl?: string | null }>;
}) {
  const readiness = registrationConfirmationDocumentReadiness(registration);
  return readiness.requiresInvoice && !readiness.invoiceUrl;
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deliveryAuthorized(status: CohortStatus) {
  return status === CohortStatus.PUBLISHED || status === CohortStatus.ACTIVE;
}

async function upsertJourneyCommunication(input: {
  journeyKey: string;
  cohortId: string;
  registrationId: string;
  participantId?: string;
  sessionId?: string;
  template: { id: string; subject: string; bodyHtml: string; bodyText: string | null };
  recipientEmail: string;
  scheduledFor?: Date;
  status: CommunicationStatus;
  skippedReason?: string;
  retryFailed?: boolean;
}) {
  const existing = await prisma.cohortCommunication.findUnique({ where: { journeyKey: input.journeyKey } });

  if (
    existing?.status === CommunicationStatus.SENT ||
    existing?.status === CommunicationStatus.SKIPPED ||
    existing?.status === CommunicationStatus.CANCELLED ||
    (existing?.status === CommunicationStatus.FAILED && !input.retryFailed)
  ) {
    return existing;
  }

  const data = {
    cohortId: input.cohortId,
    registrationId: input.registrationId,
    participantId: input.participantId,
    sessionId: input.sessionId,
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
}, fallbackW9Url?: string | null) {
  const invoice = registration.invoiceDrafts.find((item) => item.pdfFileKey && item.pdfUrl);
  const w9Url = registration.w9Url || fallbackW9Url || null;
  const documents = [
    w9Url
      ? { fileName: "RocketPD W-9.pdf", fileKey: `registration/${registration.id}/w9`, url: w9Url, provider: "external" }
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

async function prepareRegistrationConfirmationDocuments(registration: RegistrationForPocDocuments, fallbackW9Url?: string | null) {
  let readiness = registrationConfirmationDocumentReadiness(registration, fallbackW9Url);
  const requiresQuickBooksInvoice = registrationRequiresQuickBooksInvoice(registration);
  const shouldPrepareInvoicePdf = shouldAutoPrepareRegistrationInvoice(registration);

  if (!shouldPrepareInvoicePdf && !requiresQuickBooksInvoice) {
    return { registration, readiness };
  }

  try {
    const existingInvoice = registration.invoiceDrafts.find((invoice) =>
      invoice.status !== InvoiceDraftStatus.VOIDED && invoice.status !== InvoiceDraftStatus.CANCELLED
    );
    let invoice = existingInvoice;

    if (!invoice && (shouldPrepareInvoicePdf || requiresQuickBooksInvoice)) {
      invoice = await createInvoiceDraft({
        cohortId: registration.cohortId,
        registrationId: registration.id,
        organizationId: registration.organizationId
      });
    }

    if (!invoice) {
      return { registration, readiness };
    }

    let generatedInvoice = invoice.pdfFileKey && invoice.pdfUrl ? invoice : await generateInvoicePdf(invoice.id, false);
    let quickBooksError: string | null = null;
    const quickBooksReadiness = requiresQuickBooksInvoice
      ? await getQuickBooksAutomationReadiness()
      : { ready: false, environment: undefined as string | undefined };

    if (requiresQuickBooksInvoice && quickBooksReadiness.environment === "production") {
      if (!quickBooksReadiness.ready) {
        quickBooksError = quickBooksReadiness.reason ?? "QuickBooks production automation is not ready.";
      } else if (shouldAutoSyncRegistrationInvoiceToQuickBooks({
        ...registration,
        invoiceDrafts: [
          { quickBooksInvoiceRef: generatedInvoice.quickBooksInvoiceRef },
          ...registration.invoiceDrafts.filter((item) => item.id !== generatedInvoice.id)
        ]
      }, quickBooksReadiness)) {
        try {
          const quickBooks = await createQuickBooksInvoiceFromDraft(generatedInvoice.id);
          generatedInvoice = {
            ...generatedInvoice,
            quickBooksInvoiceRef: quickBooks.quickBooksInvoiceId
          };
        } catch (error) {
          quickBooksError = error instanceof Error ? error.message : "QuickBooks invoice creation failed.";
        }
      }
    }

    const invoiceDrafts = [
      {
        id: generatedInvoice.id,
        status: generatedInvoice.status,
        invoiceNumber: generatedInvoice.invoiceNumber,
        pdfFileKey: generatedInvoice.pdfFileKey,
        pdfUrl: generatedInvoice.pdfUrl,
        quickBooksInvoiceRef: generatedInvoice.quickBooksInvoiceRef
      },
      ...registration.invoiceDrafts.filter((item) => item.id !== generatedInvoice.id)
    ];
    const updatedRegistration = {
      ...registration,
      invoiceUrl: registration.invoiceUrl || generatedInvoice.pdfUrl || null,
      w9Url: registration.w9Url || fallbackW9Url || null,
      quickBooksInvoiceRef: registration.quickBooksInvoiceRef || generatedInvoice.quickBooksInvoiceRef || null,
      invoiceDrafts
    };
    readiness = registrationConfirmationDocumentReadiness(updatedRegistration, fallbackW9Url);
    if (quickBooksError) {
      readiness = {
        ...readiness,
        ready: false,
        missing: [...readiness.missing, "QuickBooks invoice link"],
        reason: `${readiness.reason ?? "POC confirmation held."} QuickBooks invoice creation/linking failed: ${quickBooksError}`
      };
    }

    const updateData: {
      invoiceUrl?: string;
      w9Url?: string;
      supportingDocumentStatus?: SupportingDocumentStatus;
    } = {};
    if (!registration.invoiceUrl && generatedInvoice.pdfUrl) {
      updateData.invoiceUrl = generatedInvoice.pdfUrl;
    }
    if (!registration.w9Url && fallbackW9Url) {
      updateData.w9Url = fallbackW9Url;
    }
    if (readiness.ready) {
      updateData.supportingDocumentStatus = SupportingDocumentStatus.READY;
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.registration.update({ where: { id: registration.id }, data: updateData });
    }

    return { registration: updatedRegistration, readiness };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      registration,
      readiness: {
        ...readiness,
        reason: `${readiness.reason ?? "POC confirmation held."} Auto invoice PDF generation failed: ${message}`
      }
    };
  }
}

async function syncFutureCalendarInvites(registration: {
  cohortId: string;
  id: string;
  primaryContactName: string;
  primaryContactEmail: string;
  participantCount: number;
  participants: Array<{
    firstName: string;
    lastName: string;
    email: string;
  }>;
  cohort: {
    title: string;
    description: string | null;
    status: CohortStatus;
    presenter: { firstName: string; lastName: string };
    sessions: Array<{
      id: string;
      title: string;
      description: string | null;
      sessionNumber: number;
      startTime: Date;
      endTime: Date;
      timezone: string;
      meetingUrl: string | null;
      location: string | null;
      calendarEvents: Array<{ provider: string; providerEventId: string | null }>;
    }>;
  };
}, options: { sendUpdates?: boolean; recipientEmails?: string[] } = {}) {
  if (!deliveryAuthorized(registration.cohort.status)) {
    return { updated: 0, failed: 0, status: "waiting_for_publish" as const, details: { updated: [], failed: [] } };
  }

  const futureLinkedSessions = registration.cohort.sessions.filter((session) =>
    session.startTime.getTime() > Date.now() && session.calendarEvents.some((event) => event.provider === "google" && event.providerEventId)
  );
  const updated: Array<{ sessionId: string; title: string; attendeeCount: number }> = [];
  const failed: Array<{ sessionId: string; title: string; error: string; missingAttendees?: string[] }> = [];

  if (futureLinkedSessions.length === 0) {
    return {
      updated: 0,
      failed: 0,
      status: registration.cohort.sessions.some((session) => session.startTime.getTime() > Date.now())
        ? "no_linked_google_events" as const
        : "no_future_sessions" as const,
      details: { updated, failed }
    };
  }

  for (const session of futureLinkedSessions) {
    try {
      const result = await createCalendarInvitePlaceholder(session.id, "google", { sendUpdates: options.sendUpdates });
      updated.push({
        sessionId: session.id,
        title: session.title,
        attendeeCount: result.attendeeCount ?? 0
      });
    } catch (error) {
      const missingAttendees = Array.isArray((error as { missingAttendees?: unknown }).missingAttendees)
        ? (error as { missingAttendees: unknown[] }).missingAttendees.map(String)
        : undefined;
      failed.push({
        sessionId: session.id,
        title: session.title,
        error: error instanceof Error ? error.message : "Google Calendar update failed",
        missingAttendees
      });
    }
  }
  const fallback = failed.length > 0 ? await sendCalendarFallbacks(registration, failed) : { sent: 0, failed: 0, details: [] };
  const calendarFiles = failed.length === 0 && options.sendUpdates !== true
    ? await sendRegistrationCalendarFiles(registration, futureLinkedSessions, options.recipientEmails)
    : { sent: 0, failed: 0, details: [] };

  return {
    updated: updated.length,
    failed: failed.length,
    status: failed.length > 0 ? "failed" as const : "synced" as const,
    details: { updated, failed, fallback, calendarFiles }
  };
}

function calendarFileName(sessionNumber: number, title: string) {
  const safeTitle = title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "session";
  return `session-${sessionNumber}-${safeTitle}.ics`;
}

function resolveCalendarFileRecipients(
  registration: Parameters<typeof syncFutureCalendarInvites>[0],
  requestedEmails?: string[]
) {
  const requested = requestedEmails?.length
    ? new Set(requestedEmails.map(normalizeEmail).filter(Boolean))
    : null;
  const recipients = new Map<string, { email: string; firstName?: string }>();

  for (const participant of registration.participants) {
    const email = normalizeEmail(participant.email);
    if (!email || (requested && !requested.has(email))) {
      continue;
    }
    recipients.set(email, { email, firstName: participant.firstName });
  }

  const pocEmail = normalizeEmail(registration.primaryContactEmail);
  if (
    pocEmail
    && (requested?.has(pocEmail) || (!requested && registration.participantCount <= 1 && recipients.size === 0))
  ) {
    recipients.set(pocEmail, { email: pocEmail, firstName: registration.primaryContactName.split(/\s+/)[0] });
  }

  return [...recipients.values()];
}

async function sendRegistrationCalendarFiles(
  registration: Parameters<typeof syncFutureCalendarInvites>[0],
  sessions: Parameters<typeof syncFutureCalendarInvites>[0]["cohort"]["sessions"],
  requestedEmails?: string[]
) {
  const recipients = resolveCalendarFileRecipients(registration, requestedEmails);
  const details: Array<{ email: string; status: string; sessions?: number; error?: string }> = [];

  if (recipients.length === 0 || sessions.length === 0) {
    return { sent: 0, failed: 0, details };
  }

  const systemUserId = await getSystemUserId();
  const presenterName = [registration.cohort.presenter.firstName, registration.cohort.presenter.lastName].filter(Boolean).join(" ");

  for (const recipient of recipients) {
    const journeyKey = `registration:${registration.id}:calendar-files:${recipient.email}`;
    const existing = await prisma.cohortCommunication.findUnique({ where: { journeyKey } });
    if (existing?.status === CommunicationStatus.SENT) {
      details.push({ email: recipient.email, status: "already_sent" });
      continue;
    }

    const subject = `Calendar files for ${registration.cohort.title}`;
    const greeting = recipient.firstName ? `Hello ${recipient.firstName},` : "Hello,";
    const bodyText = [
      greeting,
      "",
      `Your calendar files for ${registration.cohort.title} are attached.`,
      "",
      "Please open the attached .ics files to add each live session to your calendar. Each file includes the Zoom link and session details.",
      "",
      "The RocketPD Team"
    ].join("\n");
    const bodyHtml = `<p>${escapeHtml(greeting)}</p><p>Your calendar files for <strong>${escapeHtml(registration.cohort.title)}</strong> are attached.</p><p>Please open the attached .ics files to add each live session to your calendar. Each file includes the Zoom link and session details.</p><p>The RocketPD Team</p>`;
    const communication = existing
      ? await prisma.cohortCommunication.update({
          where: { id: existing.id },
          data: {
            subject,
            bodyHtml,
            bodyText,
            status: CommunicationStatus.SENDING,
            recipientEmails: [recipient.email],
            providerError: null
          }
        })
      : await prisma.cohortCommunication.create({
          data: {
            cohortId: registration.cohortId,
            registrationId: registration.id,
            journeyKey,
            subject,
            bodyHtml,
            bodyText,
            recipientScope: RecipientScope.CUSTOM,
            recipientEmails: [recipient.email],
            status: CommunicationStatus.SENDING,
            createdById: systemUserId
          }
        });

    try {
      const sendResult = await sendEmail({
        to: recipient.email,
        subject,
        bodyHtml,
        bodyText,
        attachments: sessions.map((session, index) => ({
          fileName: calendarFileName(session.sessionNumber ?? index + 1, session.title),
          contentType: "text/calendar; method=REQUEST",
          content: generateSessionIcs({
            ...session,
            cohort: {
              title: registration.cohort.title,
              description: registration.cohort.description,
              presenterName
            }
          })
        }))
      });
      await prisma.emailEvent.create({
        data: {
          communicationId: communication.id,
          recipientEmail: recipient.email,
          provider: "sendgrid",
          providerMessageId: sendResult.providerMessageId,
          eventType: EmailEventType.SENT
        }
      });
      await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          providerError: "Calendar files sent directly to the new registration recipient."
        }
      });
      details.push({ email: recipient.email, status: "sent", sessions: sessions.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar file send failed";
      await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.FAILED,
          providerError: message
        }
      });
      details.push({ email: recipient.email, status: "failed", error: message });
    }
  }

  return {
    sent: details.filter((detail) => detail.status === "sent" || detail.status === "already_sent").length,
    failed: details.filter((detail) => detail.status === "failed").length,
    details
  };
}

async function sendCalendarFallbacks(
  registration: Parameters<typeof syncFutureCalendarInvites>[0],
  failed: Array<{ sessionId: string; missingAttendees?: string[] }>
) {
  const missingByEmail = new Map<string, Set<string>>();

  for (const failure of failed) {
    for (const email of failure.missingAttendees ?? []) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) continue;
      missingByEmail.set(normalized, (missingByEmail.get(normalized) ?? new Set()).add(failure.sessionId));
    }
  }

  const details = [];
  const systemUserId = await getSystemUserId();
  const presenterName = [registration.cohort.presenter.firstName, registration.cohort.presenter.lastName].filter(Boolean).join(" ");

  for (const [email, sessionIds] of missingByEmail.entries()) {
    const journeyKey = `registration:${registration.id}:calendar-fallback:${email}`;
    const existing = await prisma.cohortCommunication.findUnique({ where: { journeyKey } });
    if (existing?.status === CommunicationStatus.SENT) {
      details.push({ email, status: "already_sent" });
      continue;
    }

    const sessions = registration.cohort.sessions
      .filter((session) => sessionIds.has(session.id))
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    if (sessions.length === 0) {
      continue;
    }

    const subject = `Calendar files for ${registration.cohort.title}`;
    const bodyText = [
      "Hello,",
      "",
      `Google Calendar did not attach you directly to ${registration.cohort.title}, so we are sending calendar files you can add manually.`,
      "",
      "Please open the attached .ics files to add the cohort sessions to your calendar. Each file includes the Zoom link and session details.",
      "",
      "The RocketPD Team"
    ].join("\n");
    const bodyHtml = `<p>Hello,</p><p>Google Calendar did not attach you directly to <strong>${escapeHtml(registration.cohort.title)}</strong>, so we are sending calendar files you can add manually.</p><p>Please open the attached .ics files to add the cohort sessions to your calendar. Each file includes the Zoom link and session details.</p><p>The RocketPD Team</p>`;
    const communication = existing
      ? await prisma.cohortCommunication.update({
          where: { id: existing.id },
          data: {
            subject,
            bodyHtml,
            bodyText,
            status: CommunicationStatus.SENDING,
            recipientEmails: [email],
            providerError: null
          }
        })
      : await prisma.cohortCommunication.create({
          data: {
            cohortId: registration.cohortId,
            registrationId: registration.id,
            journeyKey,
            subject,
            bodyHtml,
            bodyText,
            recipientScope: RecipientScope.CUSTOM,
            recipientEmails: [email],
            status: CommunicationStatus.SENDING,
            createdById: systemUserId
          }
        });

    try {
      const sendResult = await sendEmail({
        to: email,
        subject,
        bodyHtml,
        bodyText,
        attachments: sessions.map((session, index) => ({
          fileName: calendarFileName(session.sessionNumber ?? index + 1, session.title),
          contentType: "text/calendar; method=REQUEST",
          content: generateSessionIcs({
            ...session,
            cohort: {
              title: registration.cohort.title,
              description: registration.cohort.description,
              presenterName
            }
          })
        }))
      });
      await prisma.emailEvent.create({
        data: {
          communicationId: communication.id,
          recipientEmail: email,
          provider: "sendgrid",
          providerMessageId: sendResult.providerMessageId,
          eventType: EmailEventType.SENT
        }
      });
      await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.SENT,
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          providerError: "Google Calendar omitted this attendee; ICS fallback sent."
        }
      });
      details.push({ email, status: "sent", sessions: sessions.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ICS fallback send failed";
      await prisma.cohortCommunication.update({
        where: { id: communication.id },
        data: {
          status: CommunicationStatus.FAILED,
          providerError: message
        }
      });
      details.push({ email, status: "failed", error: message });
    }
  }

  return {
    sent: details.filter((detail) => detail.status === "sent" || detail.status === "already_sent").length,
    failed: details.filter((detail) => detail.status === "failed").length,
    details
  };
}

async function recordCalendarEnrollmentOutcome(registration: {
  id: string;
  cohortId: string;
  primaryContactEmail: string;
}, calendar: Awaited<ReturnType<typeof syncFutureCalendarInvites>>) {
  const openTaskWhere = {
    registrationId: registration.id,
    category: OperationsTaskCategory.CALENDAR_INVITE,
    status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
  };

  if (calendar.status === "synced") {
    await prisma.operationsTask.updateMany({
      where: openTaskWhere,
      data: {
        status: OperationsTaskStatus.COMPLETED,
        completedAt: new Date(),
        description: `Calendar enrollment verified for ${calendar.updated} future session${calendar.updated === 1 ? "" : "s"}.`
      }
    });
    return;
  }

  if (calendar.status === "waiting_for_publish" || calendar.status === "no_future_sessions") {
    return;
  }

  const firstError = calendar.details.failed[0]?.error;
  const description = calendar.status === "no_linked_google_events"
    ? "Registration was saved, but this published cohort has no linked future Google Calendar events to enroll attendees into."
    : [
        `Registration was saved, but Google Calendar enrollment failed for ${calendar.failed} future session${calendar.failed === 1 ? "" : "s"}.`,
        firstError ? `First error: ${firstError}` : null,
        calendar.details.fallback?.sent
          ? `Fallback calendar file email sent for ${calendar.details.fallback.sent} recipient${calendar.details.fallback.sent === 1 ? "" : "s"}.`
          : null
      ].filter(Boolean).join(" ");

  const existing = await prisma.operationsTask.findFirst({ where: openTaskWhere });
  const data = {
    cohortId: registration.cohortId,
    registrationId: registration.id,
    title: `Verify calendar invites for ${registration.primaryContactEmail}`,
    description,
    category: OperationsTaskCategory.CALENDAR_INVITE,
    priority: OperationsTaskPriority.URGENT,
    status: OperationsTaskStatus.OPEN
  };

  if (existing) {
    await prisma.operationsTask.update({ where: { id: existing.id }, data });
    return;
  }

  await prisma.operationsTask.create({ data });
}

export async function planRegistrationJourneys(
  registrationId: string,
  options: {
    syncCalendar?: boolean;
    sendPocConfirmation?: boolean;
    participantEmails?: string[];
    retryFailed?: boolean;
    planMilestones?: boolean;
    participantConfirmationCohortScoped?: boolean;
    participantConfirmationBatchKey?: string;
    bypassCohortStatusForImmediate?: boolean;
    calendarSendUpdates?: boolean;
  } = {}
) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      organization: true,
      participants: { where: { status: ParticipantStatus.REGISTERED } },
      invoiceDrafts: { orderBy: { updatedAt: "desc" } },
      cohort: {
        include: {
          presenter: true,
          sessions: {
            orderBy: { startTime: "asc" },
            include: { calendarEvents: { where: { provider: "google" } } }
          }
        }
      }
    }
  });

  if (!registration || registration.archivedAt || registration.status === RegistrationStatus.CANCELLED) {
    return { registrationId, planned: 0, sent: 0, failed: 0, failedCommunicationIds: [], skipped: 0, ignored: true };
  }

  const templates = await ensureDefaultCommunicationTemplates();
  const invoiceProfile = await getOrganizationInvoiceProfile();
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
  const {
    registration: registrationForDocuments,
    readiness: pocDocumentReadiness
  } = await prepareRegistrationConfirmationDocuments(registration, invoiceProfile.w9Url);
  const poc = await upsertJourneyCommunication({
    journeyKey: `registration:${registration.id}:poc:${pocEmail}:confirmation`,
    cohortId: registration.cohortId,
    registrationId: registration.id,
    template: template(journeyTemplateNames.pocConfirmation),
    recipientEmail: pocEmail,
    status: CommunicationStatus.DRAFT,
    skippedReason: pocDocumentReadiness.reason ?? undefined,
    retryFailed: options.retryFailed
  });
  const attachmentCount = await attachRegistrationDocuments(poc.id, registrationForDocuments, invoiceProfile.w9Url);
  planned.push(poc);
  if (options.sendPocConfirmation !== false && pocDocumentReadiness.ready) {
    if ((!registrationForDocuments.w9Url && pocDocumentReadiness.w9Url) || (!registrationForDocuments.invoiceUrl && pocDocumentReadiness.invoiceUrl)) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: {
          w9Url: registrationForDocuments.w9Url || pocDocumentReadiness.w9Url || undefined,
          invoiceUrl: registrationForDocuments.invoiceUrl || pocDocumentReadiness.invoiceUrl || undefined,
          supportingDocumentStatus: SupportingDocumentStatus.READY
        }
      });
    }
    immediate.push(poc);
  }

  const firstSession = registration.cohort.sessions[0];
  const milestones = firstSession && options.planMilestones !== false ? buildRegistrationMilestones(firstSession.startTime) : [];
  const targetParticipantEmails = options.participantEmails
    ? new Set(options.participantEmails.map(normalizeEmail))
    : null;

  if (milestones.length > 0) {
    await prisma.cohortCommunication.updateMany({
      where: {
        registrationId: registration.id,
        journeyKey: { endsWith: ":month-before" },
        status: { in: cancellableJourneyStatuses }
      },
      data: {
        status: CommunicationStatus.CANCELLED,
        providerError: "Cancelled because the cohort prep journey now uses the three-week milestone."
      }
    });
  }

  for (const participant of registration.participants) {
    const email = normalizeEmail(participant.email);
    if (targetParticipantEmails && !targetParticipantEmails.has(email)) {
      continue;
    }
    const confirmation = await upsertJourneyCommunication({
      journeyKey: participantConfirmationJourneyKey({
        registrationId: registration.id,
        participantEmail: email,
        cohortId: options.participantConfirmationCohortScoped ? registration.cohortId : undefined,
        batchKey: options.participantConfirmationBatchKey
      }),
      cohortId: registration.cohortId,
      registrationId: registration.id,
      participantId: participant.id,
      template: template(journeyTemplateNames.participantConfirmation),
      recipientEmail: email,
      status: CommunicationStatus.DRAFT,
      retryFailed: options.retryFailed
    });
    planned.push(confirmation);
    immediate.push(confirmation);

    for (const milestone of milestones) {
      planned.push(await upsertJourneyCommunication({
        journeyKey: `registration:${registration.id}:participant:${email}:${milestone.key}`,
        cohortId: registration.cohortId,
        registrationId: registration.id,
        participantId: participant.id,
        sessionId: firstSession?.id,
        template: template(milestone.templateName),
        recipientEmail: email,
        scheduledFor: milestone.scheduledFor,
        status: milestone.eligible ? CommunicationStatus.SCHEDULED : CommunicationStatus.SKIPPED,
        skippedReason: milestone.eligible ? undefined : "Skipped because this participant was registered after the milestone date.",
        retryFailed: options.retryFailed
      }));
    }
  }

  const sent = [];
  const failed: string[] = [];
  if (deliveryAuthorized(registration.cohort.status) || options.bypassCohortStatusForImmediate) {
    for (const communication of immediate) {
      if (communication.status === CommunicationStatus.DRAFT) {
        try {
          sent.push(await sendCommunication(communication.id, { bypassCohortStatus: options.bypassCohortStatusForImmediate }));
        } catch {
          // The failed communication remains visible and retryable in Communications.
          failed.push(communication.id);
        }
      }
    }
  }

  if (sent.some((communication) => communication.id === poc.id) && attachmentCount > 0) {
    await prisma.registration.update({
      where: { id: registration.id },
      data: {
        confirmationDocsSentAt: new Date(),
        supportingDocumentStatus: SupportingDocumentStatus.SENT
      }
    });
  }

  let calendar: Awaited<ReturnType<typeof syncFutureCalendarInvites>> = {
    updated: 0,
    failed: 0,
    status: "waiting_for_publish" as const,
    details: { updated: [], failed: [] }
  };
  if (options.syncCalendar !== false) {
    calendar = await syncFutureCalendarInvites(registration, {
      sendUpdates: options.calendarSendUpdates === true,
      recipientEmails: options.participantEmails
    });
    await recordCalendarEnrollmentOutcome(registration, calendar);
  }

  return {
    registrationId,
    planned: planned.length,
    sent: sent.length,
    failed: failed.length,
    failedCommunicationIds: failed,
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

export async function skipPocRegistrationConfirmationsForCohort(cohortId: string, reason: string) {
  const registrations = await prisma.registration.findMany({
    where: { cohortId, archivedAt: null, status: { not: RegistrationStatus.CANCELLED } },
    include: { cohort: true }
  });
  const templates = await ensureDefaultCommunicationTemplates();
  const template = templates.find((row) => row.name === journeyTemplateNames.pocConfirmation);

  if (!template) {
    throw Object.assign(new Error(`${journeyTemplateNames.pocConfirmation} template is unavailable.`), { code: "NOT_FOUND", status: 404 });
  }

  const createdById = await getSystemUserId();
  const results = [];

  for (const registration of registrations) {
    const recipientEmail = normalizeEmail(registration.primaryContactEmail);
    const journeyKey = `registration:${registration.id}:poc:${recipientEmail}:confirmation`;
    const data = {
      cohortId: registration.cohortId,
      registrationId: registration.id,
      templateId: template.id,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      scheduledFor: null,
      status: CommunicationStatus.SKIPPED,
      recipientScope: RecipientScope.CUSTOM,
      recipientEmails: [recipientEmail],
      providerError: reason
    };
    const existing = await prisma.cohortCommunication.findUnique({ where: { journeyKey } });

    if (existing?.status === CommunicationStatus.SENT) {
      results.push(existing);
      continue;
    }

    results.push(existing
      ? await prisma.cohortCommunication.update({ where: { id: existing.id }, data })
      : await prisma.cohortCommunication.create({ data: { ...data, journeyKey, createdById } }));
  }

  return {
    cohortId,
    skipped: results.filter((result) => result.status === CommunicationStatus.SKIPPED).length,
    alreadySent: results.filter((result) => result.status === CommunicationStatus.SENT).length,
    registrationCount: registrations.length
  };
}
