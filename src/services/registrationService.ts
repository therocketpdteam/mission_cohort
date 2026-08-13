import { randomUUID } from "node:crypto";
import { CommunicationStatus, ParticipantListStatus, PaymentStatus, Prisma, RegistrationStatus, SupportingDocumentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { shouldDefaultPrimaryContactParticipant } from "@/lib/rosterStatus";
import { registrationCreateSchema, registrationUpdateSchema } from "@/validators/registration";
import { logAuditEventAsync } from "./auditService";
import { createDefaultRegistrationOperationsTasks } from "./operationsTaskService";
import { queueParticipantCrmSync, queueRegistrationCrmSync } from "./crmSyncService";
import { syncRegistrationToCrmWebhook } from "./crmRegistrationWebhookService";
import { voidRegistrationQuickBooksInvoice } from "./quickBooksService";
import { automaticRegistrationJourneyOptions, cancelRegistrationJourneys, planRegistrationJourneys } from "./registrationJourneyService";
import { syncRegistrationParticipantListStatus } from "./participantService";
import { syncPaymentRecordsToRegistrationStatus } from "./paymentService";
import { shouldDeferRegistrationDelivery, stageParticipantAddition, stageRegistrationFieldChanges } from "./registrationChangeService";
import { removeFutureGoogleCalendarAttendees, syncFutureLinkedGoogleCalendarInvitesForCohort } from "./calendarService";

type BulkMoveRegistrationSummaryInput = Array<{
  id: string;
  cohortId: string;
  participants?: unknown[];
  paymentRecords?: unknown[];
  invoiceDrafts?: Array<{ quickBooksInvoiceRef?: string | null; quickBooksCustomerRef?: string | null; quickBooksRealmId?: string | null }>;
  operationsTasks?: unknown[];
  quickBooksInvoiceRef?: string | null;
  quickBooksCustomerRef?: string | null;
  quickBooksRealmId?: string | null;
}>;

export function summarizeBulkRegistrationMove(registrations: BulkMoveRegistrationSummaryInput, targetCohortId: string) {
  const moving = registrations.filter((registration) => registration.cohortId !== targetCohortId);
  const quickBooksWarningCount = moving.filter((registration) =>
    Boolean(
      registration.quickBooksInvoiceRef ||
        registration.quickBooksCustomerRef ||
        registration.quickBooksRealmId ||
        registration.invoiceDrafts?.some((invoice) => invoice.quickBooksInvoiceRef || invoice.quickBooksCustomerRef || invoice.quickBooksRealmId)
    )
  ).length;

  return {
    requestedCount: registrations.length,
    movedCount: moving.length,
    skippedAlreadyInTargetCount: registrations.length - moving.length,
    participantCount: moving.reduce((sum, registration) => sum + (registration.participants?.length ?? 0), 0),
    paymentRecordCount: moving.reduce((sum, registration) => sum + (registration.paymentRecords?.length ?? 0), 0),
    invoiceDraftCount: moving.reduce((sum, registration) => sum + (registration.invoiceDrafts?.length ?? 0), 0),
    operationsTaskCount: moving.reduce((sum, registration) => sum + (registration.operationsTasks?.length ?? 0), 0),
    sourceCohortIds: Array.from(new Set(moving.map((registration) => registration.cohortId))),
    targetCohortId,
    quickBooksWarningCount
  };
}

function splitPrimaryContactName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "Participant",
    lastName: parts.length > 1 ? parts.at(-1)! : "-"
  };
}

async function ensureSingleSeatPrimaryContactParticipant(registration: {
  id: string;
  cohortId: string;
  organizationId: string;
  participantCount: number;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string | null;
  primaryContactTitle: string | null;
}, inheritedSingleSeatDefault = false) {
  const actualCount = await prisma.participant.count({ where: { registrationId: registration.id } });
  if (!shouldDefaultPrimaryContactParticipant(registration.participantCount, actualCount) && !(inheritedSingleSeatDefault && actualCount === 0)) {
    return null;
  }

  const name = splitPrimaryContactName(registration.primaryContactName);
  const participant = await prisma.participant.create({
    data: {
      registrationId: registration.id,
      cohortId: registration.cohortId,
      organizationId: registration.organizationId,
      firstName: name.firstName,
      lastName: name.lastName,
      email: registration.primaryContactEmail.toLowerCase(),
      phone: registration.primaryContactPhone ?? undefined,
      title: registration.primaryContactTitle ?? undefined
    }
  });
  logAuditEventAsync({
    entityType: "Participant",
    entityId: participant.id,
    action: "ADDED",
    description: "Primary contact defaulted to participant for a one-seat registration",
    metadata: { registrationId: registration.id, cohortId: registration.cohortId }
  });
  void queueParticipantCrmSync(participant.id, "participant.created").catch(() => undefined);
  return { participant, created: true };
}

async function planAutomaticRegistrationJourney(registrationId: string, cohortId: string) {
  const cohort = await prisma.cohort.findUniqueOrThrow({
    where: { id: cohortId },
    select: { status: true }
  });

  return planRegistrationJourneys(registrationId, automaticRegistrationJourneyOptions(cohort.status));
}

export async function createRegistration(input: z.input<typeof registrationCreateSchema>) {
  const data = registrationCreateSchema.parse(input);
  const registration = await prisma.registration.create({ data });
  await ensureSingleSeatPrimaryContactParticipant(registration);
  const roster = await syncRegistrationParticipantListStatus(registration.id);
  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "CREATED",
    description: "Registration created",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId }
  });
  void createDefaultRegistrationOperationsTasks({
    cohortId: registration.cohortId,
    registrationId: registration.id,
    participantCount: registration.participantCount,
    actualParticipantCount: roster?.actualCount ?? 0,
    missingParticipantTitleCount: roster?.missingTitleCount ?? 0,
    paymentStatus: registration.paymentStatus,
    paymentMethod: registration.paymentMethod,
    totalAmount: Number(registration.totalAmount ?? 0),
    hasSupportingDocs: Boolean(registration.w9Url || registration.invoiceUrl || registration.confirmationDocsSentAt)
  });
  void queueRegistrationCrmSync(registration.id, "registration.created").catch(() => undefined);
  void syncRegistrationToCrmWebhook(registration.id, "registration.created").catch((error) => {
    console.error("CRM registration webhook scheduling failed", { registrationId: registration.id, error: error instanceof Error ? error.message : "Unknown error" });
  });
  const journey = await planAutomaticRegistrationJourney(registration.id, registration.cohortId);
  return { ...registration, participantListStatus: roster?.status ?? registration.participantListStatus, journey };
}

export async function updateRegistration(
  id: string,
  input: z.input<typeof registrationUpdateSchema>,
  options: { deferNotifications?: boolean } = {}
) {
  const data = registrationUpdateSchema.parse(input);
  const previous = await prisma.registration.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { participants: true } } }
  });
  const registration = await prisma.registration.update({ where: { id }, data });
  if (data.paymentStatus) {
    await syncPaymentRecordsToRegistrationStatus(registration.id, data.paymentStatus);
  }
  const fallback = await ensureSingleSeatPrimaryContactParticipant(
    registration,
    previous.participantCount === 1 && previous._count.participants === 0
  );
  const roster = await syncRegistrationParticipantListStatus(registration.id);
  void queueRegistrationCrmSync(registration.id, "registration.updated").catch(() => undefined);
  void syncRegistrationToCrmWebhook(registration.id, "registration.updated").catch((error) => {
    console.error("CRM registration webhook scheduling failed", { registrationId: registration.id, error: error instanceof Error ? error.message : "Unknown error" });
  });
  if (options.deferNotifications) {
    const cohort = await prisma.cohort.findUniqueOrThrow({ where: { id: registration.cohortId }, select: { status: true } });
    if (shouldDeferRegistrationDelivery(cohort.status)) {
      if (fallback?.created) {
        await stageParticipantAddition(registration.id, {
          participantId: fallback.participant.id,
          firstName: fallback.participant.firstName,
          lastName: fallback.participant.lastName,
          email: fallback.participant.email.toLowerCase()
        });
      }
      await stageRegistrationFieldChanges(registration.id, previous, registration);
      return {
        ...registration,
        participantListStatus: roster?.status ?? registration.participantListStatus,
        journey: { status: "pending_apply" as const }
      };
    }
  }
  const journey = registration.status === RegistrationStatus.CANCELLED
    ? await cancelRegistrationJourneys(registration.id, "Registration cancelled.")
    : await planAutomaticRegistrationJourney(registration.id, registration.cohortId);
  return { ...registration, participantListStatus: roster?.status ?? registration.participantListStatus, journey };
}

export async function syncRegistrationRosterStatuses(input: { id?: string; cohortId?: string }) {
  const ids = input.id
    ? [input.id]
    : input.cohortId
      ? (await prisma.registration.findMany({
        where: { cohortId: input.cohortId, archivedAt: null },
        select: { id: true }
      })).map((registration) => registration.id)
      : [];

  if (ids.length === 0) {
    throw Object.assign(new Error("id or cohortId is required"), { code: "BAD_REQUEST", status: 400 });
  }

  const results = [];

  for (const id of ids) {
    results.push({ registrationId: id, ...(await syncRegistrationParticipantListStatus(id)) });
  }

  return {
    updated: results.length,
    complete: results.filter((result) => result.status === ParticipantListStatus.COMPLETE).length,
    partial: results.filter((result) => result.status === ParticipantListStatus.PARTIAL).length,
    needed: results.filter((result) => result.status === ParticipantListStatus.NEEDED).length,
    notRequested: results.filter((result) => result.status === ParticipantListStatus.NOT_REQUESTED).length,
    results
  };
}

export async function confirmRegistration(id: string) {
  const registration = await updateRegistration(id, { status: RegistrationStatus.CONFIRMED });
  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "CONFIRMED",
    description: "Registration confirmed"
  });
  void queueRegistrationCrmSync(registration.id, "registration.confirmed").catch(() => undefined);
  return registration;
}

export async function cancelRegistration(id: string) {
  const existing = await prisma.registration.findUniqueOrThrow({ where: { id }, select: { cohortId: true } });
  await removeFutureGoogleCalendarAttendees({
    cohortId: existing.cohortId,
    registrationId: id,
    reason: "Registration cancelled."
  });
  const registration = await updateRegistration(id, { status: RegistrationStatus.CANCELLED });

  if (registration.quickBooksInvoiceRef) {
    void voidRegistrationQuickBooksInvoice(registration.id).catch(() => undefined);
  }

  void queueRegistrationCrmSync(registration.id, "registration.cancelled").catch(() => undefined);
  return registration;
}

export async function archiveRegistration(id: string, reason?: string) {
  const existing = await prisma.registration.findUniqueOrThrow({ where: { id }, select: { cohortId: true } });
  await removeFutureGoogleCalendarAttendees({
    cohortId: existing.cohortId,
    registrationId: id,
    reason: reason?.trim() || "Registration archived."
  });
  const registration = await prisma.registration.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      archivedReason: reason?.trim() || undefined
    }
  });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "ARCHIVED",
    description: "Registration archived",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId, reason: reason ?? null }
  });
  void queueRegistrationCrmSync(registration.id, "registration.archived").catch(() => undefined);
  await cancelRegistrationJourneys(registration.id, reason?.trim() || "Registration archived.");
  return registration;
}

export async function restoreRegistration(id: string) {
  const registration = await prisma.registration.update({
    where: { id },
    data: {
      archivedAt: null,
      archivedReason: null
    }
  });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "RESTORED",
    description: "Registration restored from archive",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId }
  });
  void queueRegistrationCrmSync(registration.id, "registration.restored").catch(() => undefined);
  const journey = await planAutomaticRegistrationJourney(registration.id, registration.cohortId);
  return { ...registration, journey };
}

export async function deleteRegistration(id: string) {
  const registration = await prisma.registration.findUnique({
    where: { id },
    include: {
      invoiceDrafts: true,
      paymentRecords: true,
      _count: { select: { participants: true, operationsTasks: true, webhookEvents: true } }
    }
  });

  if (!registration) {
    throw Object.assign(new Error("Registration not found"), { code: "NOT_FOUND", status: 404 });
  }

  const hasQuickBooksReference = Boolean(
    registration.quickBooksCustomerRef ||
      registration.quickBooksInvoiceRef ||
      registration.quickBooksRealmId ||
      registration.paymentRecords.some((payment) => payment.quickBooksInvoiceRef || payment.quickBooksPaymentRef || payment.quickBooksRealmId) ||
      registration.invoiceDrafts.some((invoice) => invoice.quickBooksInvoiceRef || invoice.quickBooksCustomerRef || invoice.quickBooksRealmId)
  );

  if (hasQuickBooksReference) {
    throw Object.assign(new Error("This registration has QuickBooks references. Archive it instead, or void/detach the finance records before permanent deletion."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  if (registration.invoiceDrafts.length > 0) {
    throw Object.assign(new Error("This registration has invoice drafts. Archive it instead, or remove the invoice drafts before permanent deletion."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  await removeFutureGoogleCalendarAttendees({
    cohortId: registration.cohortId,
    registrationId: id,
    reason: "Registration permanently deleted."
  });
  await cancelRegistrationJourneys(id, "Registration permanently deleted.");
  await prisma.registration.delete({ where: { id } });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: id,
    action: "DELETED",
    description: "Registration permanently deleted",
    metadata: {
      cohortId: registration.cohortId,
      organizationId: registration.organizationId,
      participants: registration._count.participants,
      paymentRecords: registration.paymentRecords.length,
      invoiceDrafts: registration.invoiceDrafts.length,
      operationsTasks: registration._count.operationsTasks,
      webhookEventsDetached: registration._count.webhookEvents
    }
  });

  return { id, deleted: true };
}

export async function bulkUpdateRegistrations(input: {
  ids: string[];
  action?: "confirm" | "cancel" | "archive" | "restore";
  paymentStatus?: PaymentStatus;
  supportingDocumentStatus?: SupportingDocumentStatus;
}) {
  const ids = input.ids.filter(Boolean);

  if (ids.length === 0) {
    return { count: 0 };
  }

  if (input.action === "confirm") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { status: RegistrationStatus.CONFIRMED } });
  } else if (input.action === "cancel") {
    for (const id of ids) {
      await cancelRegistration(id);
    }
    return { count: ids.length };
  } else if (input.action === "archive") {
    for (const id of ids) {
      await archiveRegistration(id, "Registration archived from bulk action.");
    }
    return { count: ids.length };
  } else if (input.action === "restore") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null, archivedReason: null } });
  } else {
    const data: {
      paymentStatus?: PaymentStatus;
      supportingDocumentStatus?: SupportingDocumentStatus;
    } = {};

    if (input.paymentStatus) {
      data.paymentStatus = input.paymentStatus;
    }

    if (input.supportingDocumentStatus) {
      data.supportingDocumentStatus = input.supportingDocumentStatus;
    }

    await prisma.registration.updateMany({ where: { id: { in: ids } }, data });

    if (input.paymentStatus) {
      await prisma.paymentRecord.updateMany({
        where: { registrationId: { in: ids } },
        data: { status: input.paymentStatus }
      });
    }
  }

  for (const id of ids) {
    void queueRegistrationCrmSync(id, "registration.bulk_updated").catch(() => undefined);
    void syncRegistrationToCrmWebhook(id, "registration.bulk_updated").catch((error) => {
      console.error("CRM registration webhook scheduling failed", { registrationId: id, error: error instanceof Error ? error.message : "Unknown error" });
    });
    if (input.action === "restore") {
      const registration = await prisma.registration.findUnique({ where: { id }, select: { cohortId: true } });
      if (registration) {
        await planAutomaticRegistrationJourney(id, registration.cohortId);
      }
    }
  }

  return { count: ids.length };
}

export async function bulkMoveRegistrationsToCohort(input: { ids: string[]; targetCohortId: string }) {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  const targetCohortId = String(input.targetCohortId ?? "").trim();

  if (ids.length === 0) {
    return { count: 0, summary: summarizeBulkRegistrationMove([], targetCohortId), cancelledCommunications: 0 };
  }

  if (!targetCohortId) {
    throw Object.assign(new Error("targetCohortId is required"), { code: "BAD_REQUEST", status: 400 });
  }

  const [targetCohort, registrations] = await Promise.all([
    prisma.cohort.findUnique({ where: { id: targetCohortId }, select: { id: true, title: true, status: true } }),
    prisma.registration.findMany({
      where: { id: { in: ids } },
      include: {
        participants: true,
        paymentRecords: true,
        invoiceDrafts: true,
        operationsTasks: true
      }
    })
  ]);

  if (!targetCohort) {
    throw Object.assign(new Error("Target cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (registrations.length !== ids.length) {
    const found = new Set(registrations.map((registration) => registration.id));
    const missing = ids.filter((id) => !found.has(id));
    throw Object.assign(new Error(`Registration${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}`), {
      code: "NOT_FOUND",
      status: 404
    });
  }

  const summary = summarizeBulkRegistrationMove(registrations, targetCohortId);
  const moveIds = registrations.filter((registration) => registration.cohortId !== targetCohortId).map((registration) => registration.id);
  const participantIds = registrations
    .filter((registration) => registration.cohortId !== targetCohortId)
    .flatMap((registration) => registration.participants.map((participant) => participant.id));

  if (moveIds.length === 0) {
    return { count: 0, summary, cancelledCommunications: 0, targetCohort };
  }

  const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const cancelled = await tx.cohortCommunication.updateMany({
      where: {
        OR: [
          { registrationId: { in: moveIds } },
          ...(participantIds.length > 0 ? [{ participantId: { in: participantIds } }] : [])
        ],
        status: { in: [CommunicationStatus.DRAFT, CommunicationStatus.SCHEDULED, CommunicationStatus.FAILED] }
      },
      data: {
        status: CommunicationStatus.CANCELLED,
        providerError: `Registration moved to ${targetCohort.title}.`
      }
    });

    await tx.registration.updateMany({
      where: { id: { in: moveIds } },
      data: {
        cohortId: targetCohortId,
        invoiceNumber: null,
        invoiceUrl: null,
        confirmationDocsSentAt: null,
        supportingDocumentStatus: SupportingDocumentStatus.NOT_READY
      }
    });
    await tx.participant.updateMany({ where: { registrationId: { in: moveIds } }, data: { cohortId: targetCohortId } });
    await tx.paymentRecord.updateMany({ where: { registrationId: { in: moveIds } }, data: { cohortId: targetCohortId } });
    await tx.invoiceDraft.updateMany({
      where: { registrationId: { in: moveIds } },
      data: {
        cohortId: targetCohortId,
        invoiceNumber: null,
        pdfFileKey: null,
        pdfUrl: null,
        receiptFileKey: null,
        receiptUrl: null
      }
    });
    await tx.operationsTask.updateMany({ where: { registrationId: { in: moveIds } }, data: { cohortId: targetCohortId } });

    return { cancelledCommunications: cancelled.count };
  });

  const moveConfirmationBatchKey = randomUUID();
  const journeyResults = [];
  const departingCalendarSync = [];

  for (const sourceCohortId of summary.sourceCohortIds) {
    departingCalendarSync.push(await syncFutureLinkedGoogleCalendarInvitesForCohort(sourceCohortId, { sendUpdates: false }));
  }

  for (const registration of registrations.filter((row) => moveIds.includes(row.id))) {
    logAuditEventAsync({
      entityType: "Registration",
      entityId: registration.id,
      action: "MOVED_COHORT",
      description: `Registration moved to ${targetCohort.title}`,
      metadata: {
        fromCohortId: registration.cohortId,
        targetCohortId,
        participantCount: registration.participants.length,
        paymentRecordCount: registration.paymentRecords.length,
        invoiceDraftCount: registration.invoiceDrafts.length,
        operationsTaskCount: registration.operationsTasks.length
      }
    });
    void queueRegistrationCrmSync(registration.id, "registration.moved").catch(() => undefined);
    void syncRegistrationToCrmWebhook(registration.id, "registration.moved").catch((error) => {
      console.error("CRM registration webhook scheduling failed", { registrationId: registration.id, error: error instanceof Error ? error.message : "Unknown error" });
    });
    for (const participant of registration.participants) {
      void queueParticipantCrmSync(participant.id, "participant.moved").catch(() => undefined);
    }
    journeyResults.push(await planRegistrationJourneys(registration.id, {
      sendPocConfirmation: true,
      retryFailed: true,
      pocConfirmationCohortScoped: true,
      pocConfirmationBatchKey: moveConfirmationBatchKey,
      participantConfirmationCohortScoped: true,
      participantConfirmationBatchKey: moveConfirmationBatchKey,
      bypassCohortStatusForImmediate: true,
      calendarSendUpdates: false,
      ...automaticRegistrationJourneyOptions(targetCohort.status)
    }));
  }

  return {
    count: moveIds.length,
    targetCohort,
    summary,
    cancelledCommunications: transactionResult.cancelledCommunications,
    departingCalendarSync,
    confirmationsSent: journeyResults.reduce((total, result) => total + Number(result.sent ?? 0), 0),
    confirmationFailures: journeyResults.reduce((total, result) => total + Number(result.failed ?? 0), 0)
  };
}

export async function listRegistrations(cohortId?: string, options: { includeArchived?: boolean } = {}) {
  return prisma.registration.findMany({
    where: {
      ...(cohortId ? { cohortId } : {}),
      ...(options.includeArchived ? {} : { archivedAt: null })
    },
    orderBy: { createdAt: "desc" },
    include: {
      cohort: true,
      organization: true,
      participants: { select: { firstName: true, lastName: true, email: true, status: true } },
      _count: { select: { participants: true } }
    }
  });
}

export async function getRegistrationById(id: string) {
  return prisma.registration.findUnique({
    where: { id },
    include: {
      cohort: true,
      organization: true,
      participants: true,
      paymentRecords: true,
      operationsTasks: {
        orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }]
      },
      webhookEvents: {
        where: { source: "jotform" },
        orderBy: { createdAt: "desc" },
        take: 12
      },
      communications: {
        orderBy: { createdAt: "desc" },
        include: {
          participant: true,
          template: true,
          emailEvents: { orderBy: { createdAt: "desc" } },
          attachments: true
        }
      },
      invoiceDrafts: {
        orderBy: { updatedAt: "desc" },
        include: {
          organization: true,
          lineItems: true
        }
      }
    }
  });
}
