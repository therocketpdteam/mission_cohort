import { CohortStatus, CommunicationStatus, EmailEventType, InvoiceDraftStatus, OperationsTaskCategory, OperationsTaskPriority, OperationsTaskStatus, ParticipantStatus, PaymentStatus, Prisma, RecipientScope, RegistrationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOutboundUnlocked } from "@/lib/outboundLock";
import { buildCohortCancellationPocEmail, cohortCancellationParticipantEmail, renderCohortCancellationEmail } from "@/config/cohortCancellation";
import { cohortCancellationRecipients, cancellationNoticeCanSend, runCohortCancellationSteps } from "@/modules/cohorts/cancellation";
import { cancelGoogleCalendarInvites, preflightCohortCalendarCancellation } from "./calendarService";
import { getSystemUserId, sendCommunication } from "./communicationService";
import { assertOutboundRecipientsAllowed, getSendGridSetup } from "./integrationSetupService";
import { logAuditEvent } from "./auditService";
import { queueParticipantCrmSync, queueRegistrationCrmSync } from "./crmSyncService";

const prefix = (id: string) => `cohort:${id}:cancellation:`;
const conflict = (message: string) => Object.assign(new Error(message), { code: "CANCELLATION_BLOCKED", status: 409 });

export async function getCohortCancellationPreview(cohortId: string, client: Pick<typeof prisma, "cohort" | "operationsTask"> = prisma) {
  const cohort = await client.cohort.findUniqueOrThrow({
    where: { id: cohortId },
    include: {
      sessions: { include: { calendarEvents: true } },
      registrations: {
        where: { archivedAt: null, status: { not: RegistrationStatus.CANCELLED } },
        include: { organization: true, participants: true, paymentRecords: true, invoiceDrafts: { orderBy: { updatedAt: "desc" } } }
      }
    }
  });
  const task = await client.operationsTask.findUnique({ where: { id: `cohort-cancellation:${cohortId}` } });
  const cancellationDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(task?.createdAt ?? new Date());
  const recipients = cohortCancellationRecipients(cohort.registrations);
  const blockers: string[] = [];
  const notices = recipients.map((recipient) => {
    const registration = cohort.registrations.find((row) => row.id === recipient.registrationId)!;
    const participant = registration.participants.find((row) => row.id === recipient.participantId);
    const invoice = registration.invoiceDrafts.find((row) => row.status !== InvoiceDraftStatus.VOIDED && row.status !== InvoiceDraftStatus.CANCELLED) ?? registration.invoiceDrafts[0];
    const collected = registration.paymentRecords.filter((payment) => payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.PARTIALLY_PAID);
    const receivedAmount = Math.max(collected.reduce((sum, payment) => sum + Number(payment.amount), 0), registration.invoiceDrafts.reduce((sum, row) => sum + Number(row.paidAmount), 0));
    const paymentStatus = registration.paymentStatus === PaymentStatus.REFUNDED ? PaymentStatus.REFUNDED
      : receivedAmount > 0 && receivedAmount < Number(registration.totalAmount) ? PaymentStatus.PARTIALLY_PAID
      : receivedAmount > 0 || registration.invoiceDrafts.some((row) => row.status === InvoiceDraftStatus.PAID) ? PaymentStatus.PAID
      : registration.paymentStatus;
    const payment = {
      paymentStatus,
      paymentMethod: registration.paymentMethod,
      receivedPaymentMethods: collected.map((row) => row.method),
      receivedAmount,
      invoiceStatus: invoice?.status,
      invoiceNumber: invoice?.invoiceNumber ?? registration.invoiceNumber,
      purchaseOrderNumber: registration.purchaseOrderNumber,
      cancellationDate
    };
    const template = recipient.role === "poc" ? buildCohortCancellationPocEmail(payment) : cohortCancellationParticipantEmail;
    const email = renderCohortCancellationEmail(template, {
      cohort,
      organization: registration.organization,
      registration: { ...registration, invoiceNumber: payment.invoiceNumber },
      participant
    });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) blockers.push(`A valid email is required for the registration contact: ${registration.primaryContactName}.`);
    blockers.push(...email.warnings);
    return {
      ...recipient,
      journeyKey: `${prefix(cohortId)}${recipient.role}:${recipient.role === "poc" ? `${recipient.registrationId}:${recipient.email}` : recipient.email}`,
      subject: email.subject,
      bodyHtml: email.bodyHtml,
      bodyText: email.bodyText
    };
  });
  if (cohort.status === CohortStatus.CANCELLED) blockers.push("This cohort is already cancelled.");
  return { cohort, notices, blockers: Array.from(new Set(blockers)) };
}

async function preflight(cohortId: string, plan: Awaited<ReturnType<typeof getCohortCancellationPreview>>) {
  if (plan.blockers.length) throw conflict(plan.blockers.join(" "));
  await assertOutboundUnlocked({ channel: "SENDGRID", action: "send cohort cancellation notices", entityType: "Cohort", entityId: cohortId });
  if (plan.notices.length) {
    const setup = await getSendGridSetup();
    if (!setup.configured) throw conflict("Configure SendGrid before cancelling this cohort.");
    await assertOutboundRecipientsAllowed("SENDGRID", plan.notices.map((notice) => notice.email));
  }
  if (plan.cohort.sessions.some((session) => session.calendarEvents.some((event) => event.provider === "google" && event.providerEventId))) {
    await assertOutboundUnlocked({ channel: "GOOGLE_CALENDAR", action: "cancel cohort invitations", entityType: "Cohort", entityId: cohortId });
    await preflightCohortCalendarCancellation(cohortId);
  }
  const sending = await prisma.cohortCommunication.count({ where: { cohortId, status: CommunicationStatus.SENDING } });
  if (sending) throw conflict("A communication is currently sending. Wait for it to finish or review it in Communications before continuing.");
}

async function sendNotices(plan: Awaited<ReturnType<typeof getCohortCancellationPreview>>, createdById: string) {
  const sentIds: string[] = [];
  for (const notice of plan.notices) {
    const communication = await prisma.cohortCommunication.upsert({
      where: { journeyKey: notice.journeyKey },
      update: {},
      create: {
        cohortId: plan.cohort.id,
        registrationId: notice.registrationId,
        participantId: notice.participantId,
        journeyKey: notice.journeyKey,
        subject: notice.subject,
        bodyHtml: notice.bodyHtml,
        bodyText: notice.bodyText,
        recipientScope: RecipientScope.CUSTOM,
        recipientEmails: [notice.email],
        status: CommunicationStatus.DRAFT,
        createdById
      }
    });
    // If the provider acceptance was recorded before a later DB write failed,
    // preserve that acceptance rather than sending a second copy.
    const accepted = communication.sentAt || await prisma.emailEvent.findFirst({ where: { communicationId: communication.id, eventType: EmailEventType.SENT } });
    if (accepted || !cancellationNoticeCanSend(communication.status)) {
      sentIds.push(communication.id);
      continue;
    }
    const claim = await prisma.cohortCommunication.updateMany({ where: { id: communication.id, status: CommunicationStatus.DRAFT }, data: { status: CommunicationStatus.SENDING } });
    if (claim.count !== 1) throw conflict("This cancellation notice is already being processed.");
    await sendCommunication(communication.id, { recipients: [notice.email], bypassCohortStatus: true });
    sentIds.push(communication.id);
  }
  return sentIds;
}

async function withCancellationLock<T>(cohortId: string, operation: () => Promise<T>) {
  const id = `cohort-cancellation:${cohortId}`;
  await prisma.operationsTask.upsert({
    where: { id }, update: {},
    create: { id, cohortId, title: "Cohort cancellation: email, calendar, then status", category: OperationsTaskCategory.OTHER, priority: OperationsTaskPriority.HIGH, status: OperationsTaskStatus.OPEN }
  });
  const claim = await prisma.operationsTask.updateMany({ where: { id, status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.COMPLETED] } }, data: { status: OperationsTaskStatus.IN_PROGRESS, completedAt: null } });
  if (claim.count !== 1) throw conflict("Cohort cancellation is already in progress. Review its operations task before retrying an interrupted action.");
  try {
    const result = await operation();
    await prisma.operationsTask.update({ where: { id }, data: { status: OperationsTaskStatus.COMPLETED, completedAt: new Date() } });
    return result;
  } catch (error) {
    await prisma.operationsTask.update({ where: { id }, data: { status: OperationsTaskStatus.OPEN, description: error instanceof Error ? error.message : "Cancellation stopped; review before retrying." } });
    throw error;
  }
}

export async function sendCohortCancellationNotices(cohortId: string) {
  return withCancellationLock(cohortId, async () => {
    const plan = await getCohortCancellationPreview(cohortId);
    await preflight(cohortId, plan);
    const ids = await sendNotices(plan, await getSystemUserId());
    return { id: ids[0] ?? cohortId, notices: ids.length };
  });
}

export async function cancelCohortWithNotices(cohortId: string, actorUserId: string) {
  const existing = await prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  if (existing.status === CohortStatus.CANCELLED) return existing;
  return withCancellationLock(cohortId, async () => {
    const plan = await getCohortCancellationPreview(cohortId);
    if (plan.cohort.status === CohortStatus.CANCELLED) return plan.cohort;
    const registrationIds = plan.cohort.registrations.map((registration) => registration.id);
    return runCohortCancellationSteps({
      preflight: () => preflight(cohortId, plan),
      pauseReminders: async () => {
        await prisma.cohortCommunication.updateMany({
          where: { cohortId, status: { in: [CommunicationStatus.DRAFT, CommunicationStatus.SCHEDULED, CommunicationStatus.FAILED] }, OR: [{ journeyKey: null }, { journeyKey: { not: { startsWith: prefix(cohortId) } } }] },
          data: { status: CommunicationStatus.CANCELLED, scheduledFor: null, providerError: "Paused for cohort cancellation." }
        });
      },
      sendNotices: async () => { await sendNotices(plan, actorUserId); },
      removeCalendar: async () => {
        for (const session of plan.cohort.sessions) {
          if (session.calendarEvents.some((event) => event.provider === "google" && event.providerEventId)) {
            await cancelGoogleCalendarInvites({ sessionId: session.id }, { notifyAttendees: true });
          }
        }
      },
      finalize: async () => {
        const result = await prisma.$transaction(async (tx) => {
          // Keep paid invoice and payment history intact. Refunds and external
          // invoice voids remain explicit finance follow-ups, never auto-refunds.
          const current = await tx.registration.findMany({
            where: { cohortId, archivedAt: null, status: { not: RegistrationStatus.CANCELLED } },
            include: { participants: true, paymentRecords: true, invoiceDrafts: true }
          });
          const roster = (rows: typeof current) => rows.flatMap((row) => [
            `${row.id}:${row.primaryContactEmail.trim().toLowerCase()}`,
            ...row.participants.filter((participant) => participant.status === ParticipantStatus.REGISTERED).map((participant) => `${participant.id}:${participant.email.trim().toLowerCase()}`)
          ]).sort().join("|");
          if (roster(current) !== roster(plan.cohort.registrations)) throw conflict("The registration roster changed during cancellation. Review the new roster and retry before cancelling statuses.");
          for (const registration of current) {
            const received = registration.paymentStatus === PaymentStatus.PAID || registration.paymentStatus === PaymentStatus.PARTIALLY_PAID || registration.paymentRecords.some((payment) => payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.PARTIALLY_PAID) || registration.invoiceDrafts.some((invoice) => Number(invoice.paidAmount) > 0 || invoice.status === InvoiceDraftStatus.PAID);
            if (!received && registration.paymentStatus !== PaymentStatus.REFUNDED) {
              await tx.invoiceDraft.updateMany({ where: { registrationId: registration.id, paidAmount: 0, status: { in: [InvoiceDraftStatus.DRAFT, InvoiceDraftStatus.SENT] } }, data: { status: InvoiceDraftStatus.VOIDED, pdfUrl: null, pdfFileKey: null } });
              await tx.registration.update({ where: { id: registration.id }, data: { paymentStatus: PaymentStatus.CANCELLED } });
            }
            if ((received && registration.paymentStatus !== PaymentStatus.REFUNDED) || registration.quickBooksInvoiceRef || (registration.invoiceNumber && registration.invoiceDrafts.length === 0)) {
              const id = `cohort-cancellation-finance:${registration.id}`;
              await tx.operationsTask.upsert({ where: { id }, update: {}, create: {
                id, cohortId, registrationId: registration.id,
                title: received && registration.paymentStatus !== PaymentStatus.REFUNDED ? "Arrange cancellation refund and review invoice balances" : "Review linked QuickBooks invoice after cohort cancellation",
                description: "The POC has received cancellation instructions. Confirm refunds and external invoice handling with finance; no refund was issued automatically.",
                category: OperationsTaskCategory.PAYMENT_FOLLOW_UP, priority: OperationsTaskPriority.HIGH, status: OperationsTaskStatus.OPEN
              } });
            }
          }
          await tx.paymentRecord.updateMany({ where: { registrationId: { in: registrationIds }, status: { in: [PaymentStatus.PENDING, PaymentStatus.INVOICED] } }, data: { status: PaymentStatus.CANCELLED } });
          await tx.registration.updateMany({ where: { id: { in: registrationIds } }, data: { status: RegistrationStatus.CANCELLED } });
          await tx.participant.updateMany({ where: { cohortId, status: ParticipantStatus.REGISTERED }, data: { status: ParticipantStatus.CANCELLED } });
          await tx.calendarEvent.deleteMany({ where: { cohortId, provider: "ics" } });
          await tx.operationsTask.updateMany({ where: { cohortId, status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }, category: { notIn: [OperationsTaskCategory.PAYMENT_FOLLOW_UP, OperationsTaskCategory.QUICKBOOKS_REVIEW] }, id: { not: `cohort-cancellation:${cohortId}` } }, data: { status: OperationsTaskStatus.CANCELLED } });
          return tx.cohort.update({ where: { id: cohortId }, data: { status: CohortStatus.CANCELLED } });
        }, { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await logAuditEvent({ actorUserId, entityType: "Cohort", entityId: cohortId, action: "CANCELLED", description: "Sent role-specific cancellation notices, removed calendar invitations, and cancelled cohort registrations and participants.", metadata: { notices: plan.notices.length, registrations: registrationIds.length } });
        for (const registration of plan.cohort.registrations) {
          void queueRegistrationCrmSync(registration.id, "registration.cancelled").catch(() => undefined);
          for (const participant of registration.participants) void queueParticipantCrmSync(participant.id, "participant.cancelled").catch(() => undefined);
        }
        return result;
      }
    });
  });
}
