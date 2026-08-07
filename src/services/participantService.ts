import { randomUUID } from "node:crypto";
import { InvoiceDraftStatus, OperationsTaskCategory, OperationsTaskStatus, ParticipantListStatus, ParticipantStatus, PaymentMethod, PaymentStatus, Prisma, RegistrationStatus, SupportingDocumentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { countParticipantsMissingTitles, deriveParticipantListStatus } from "@/lib/rosterStatus";
import { participantCreateSchema, participantUpdateSchema } from "@/validators/participant";
import { logAuditEventAsync } from "./auditService";
import { queueParticipantCrmSync, queueRegistrationCrmSync } from "./crmSyncService";
import { syncRegistrationToCrm, syncRemovedParticipantToCrm } from "./crmRegistrationWebhookService";
import { getRecipientCommunicationSummary } from "./communicationService";
import { cancelParticipantJourneys, planRegistrationJourneys } from "./registrationJourneyService";
import { shouldDeferRegistrationDelivery, stageParticipantAddition, stageParticipantRemoval } from "./registrationChangeService";
import { syncFutureLinkedGoogleCalendarInvitesForCohort } from "./calendarService";
import { createInvoiceDraft, generateInvoicePdf, updateInvoiceDraft } from "./invoiceService";

type ParticipantMutationOptions = { deferNotifications?: boolean };
type BulkMoveParticipantSummaryInput = Array<{
  id: string;
  cohortId: string;
  registrationId: string;
  organizationId: string;
  email: string;
  status?: ParticipantStatus | string | null;
}>;

export function summarizeBulkParticipantMove(participants: BulkMoveParticipantSummaryInput, targetCohortId: string) {
  const moving = participants.filter((participant) => participant.cohortId !== targetCohortId);

  return {
    requestedCount: participants.length,
    movedCount: moving.length,
    skippedAlreadyInTargetCount: participants.length - moving.length,
    sourceRegistrationIds: Array.from(new Set(moving.map((participant) => participant.registrationId))).sort(),
    sourceCohortIds: Array.from(new Set(moving.map((participant) => participant.cohortId))).sort(),
    organizationIds: Array.from(new Set(moving.map((participant) => participant.organizationId))).sort(),
    nonRegisteredCount: moving.filter((participant) => participant.status && participant.status !== ParticipantStatus.REGISTERED).length
  };
}

function moneyNumber(value: unknown) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function registrationPaidAmount(registration: { paymentRecords?: Array<{ amount: unknown; status: PaymentStatus | string }> }) {
  return (registration.paymentRecords ?? [])
    .filter((payment) => payment.status === PaymentStatus.PAID)
    .reduce((sum, payment) => sum + moneyNumber(payment.amount), 0);
}

function paymentStatusForAmount(totalAmount: number, paidAmount: number, fallback: PaymentStatus = PaymentStatus.INVOICED) {
  if (totalAmount <= 0) {
    return PaymentStatus.PAID;
  }
  if (paidAmount >= totalAmount) {
    return PaymentStatus.PAID;
  }
  if (paidAmount > 0) {
    return PaymentStatus.PARTIALLY_PAID;
  }
  return fallback === PaymentStatus.PAID ? PaymentStatus.INVOICED : fallback;
}

function invoiceStatusForAmount(totalAmount: number, paidAmount: number) {
  return totalAmount > 0 && paidAmount >= totalAmount ? InvoiceDraftStatus.PAID : InvoiceDraftStatus.DRAFT;
}

export function calculatePartialParticipantMoveFinance(input: {
  sourceTotalAmount: unknown;
  sourcePaidAmount: unknown;
  sourceParticipantCount: unknown;
  movedCount: number;
  targetUnitAmount: unknown;
  sourcePaymentStatus: PaymentStatus;
}) {
  const sourceTotalBefore = moneyNumber(input.sourceTotalAmount);
  const sourcePaidBefore = moneyNumber(input.sourcePaidAmount);
  const sourceCountBefore = Math.max(Number(input.sourceParticipantCount ?? 0), input.movedCount);
  const remainingCount = Math.max(0, sourceCountBefore - input.movedCount);
  const targetUnitAmount = moneyNumber(input.targetUnitAmount);
  const targetTotalAmount = moneyNumber(targetUnitAmount * input.movedCount);
  const targetPaidAmount = input.sourcePaymentStatus === PaymentStatus.PAID
    ? Math.min(targetTotalAmount, sourcePaidBefore)
    : 0;
  const sourceTotalAfter = moneyNumber(Math.max(0, sourceTotalBefore - targetTotalAmount));
  const sourcePaidAfter = moneyNumber(Math.max(0, sourcePaidBefore - targetPaidAmount));

  return {
    remainingCount,
    targetUnitAmount,
    targetTotalAmount,
    targetPaidAmount,
    targetPaymentStatus: paymentStatusForAmount(targetTotalAmount, targetPaidAmount),
    sourceTotalAfter,
    sourcePaidAfter,
    sourcePaymentStatus: paymentStatusForAmount(sourceTotalAfter, sourcePaidAfter, input.sourcePaymentStatus)
  };
}

async function reducePaidPaymentRecords(tx: Prisma.TransactionClient, records: Array<{ id: string; amount: unknown; status: PaymentStatus | string }>, reductionAmount: number) {
  let remaining = moneyNumber(reductionAmount);

  for (const record of records.filter((payment) => payment.status === PaymentStatus.PAID)) {
    if (remaining <= 0) {
      break;
    }

    const currentAmount = moneyNumber(record.amount);
    const reduction = Math.min(currentAmount, remaining);
    await tx.paymentRecord.update({
      where: { id: record.id },
      data: {
        amount: moneyNumber(currentAmount - reduction),
        notes: "Adjusted automatically after a partial participant move to another cohort."
      }
    });
    remaining = moneyNumber(remaining - reduction);
  }
}

async function prepareMovedRegistrationInvoice(registrationId: string) {
  const registration = await prisma.registration.findUniqueOrThrow({
    where: { id: registrationId },
    include: {
      organization: true,
      invoiceDrafts: {
        where: { status: { notIn: [InvoiceDraftStatus.VOIDED, InvoiceDraftStatus.CANCELLED] } },
        orderBy: { updatedAt: "desc" },
        include: { lineItems: true }
      },
      paymentRecords: true
    }
  });
  const totalAmount = moneyNumber(registration.totalAmount);
  const paidAmount = Math.min(totalAmount, registrationPaidAmount(registration));
  const invoiceStatus = invoiceStatusForAmount(totalAmount, paidAmount);
  const existingInvoice = registration.invoiceDrafts[0];
  const invoice = existingInvoice
    ? await updateInvoiceDraft(existingInvoice.id, {
        cohortId: registration.cohortId,
        registrationId: registration.id,
        organizationId: registration.organizationId,
        purchaseOrderNumber: registration.purchaseOrderNumber ?? undefined,
        status: invoiceStatus,
        paidAmount,
        lineItems: existingInvoice.lineItems.length === 1
          ? [{
              description: existingInvoice.lineItems[0]!.description,
              quantity: Math.max(registration.participantCount, 1),
              unitAmount: registration.participantCount ? totalAmount / Math.max(registration.participantCount, 1) : 0
            }]
          : undefined
      })
    : await createInvoiceDraft({
        cohortId: registration.cohortId,
        registrationId: registration.id,
        organizationId: registration.organizationId,
        status: invoiceStatus,
        paidAmount
      });

  const generated = await generateInvoicePdf(invoice.id, false);
  await prisma.registration.update({
    where: { id: registration.id },
    data: { invoiceUrl: generated.pdfUrl ?? undefined }
  });
  return generated;
}

async function refreshSplitSourceInvoice(registrationId: string) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      invoiceDrafts: {
        where: { status: { notIn: [InvoiceDraftStatus.VOIDED, InvoiceDraftStatus.CANCELLED] } },
        orderBy: { updatedAt: "desc" },
        include: { lineItems: true }
      },
      paymentRecords: true
    }
  });
  const invoice = registration?.invoiceDrafts[0];
  if (!registration || !invoice || invoice.lineItems.length !== 1) {
    return null;
  }

  const totalAmount = moneyNumber(registration.totalAmount);
  const paidAmount = Math.min(totalAmount, registrationPaidAmount(registration));
  const updated = await updateInvoiceDraft(invoice.id, {
    cohortId: registration.cohortId,
    registrationId: registration.id,
    organizationId: registration.organizationId,
    purchaseOrderNumber: registration.purchaseOrderNumber ?? undefined,
    status: invoiceStatusForAmount(totalAmount, paidAmount),
    paidAmount,
    lineItems: [{
      description: invoice.lineItems[0]!.description,
      quantity: Math.max(registration.participantCount, 1),
      unitAmount: registration.participantCount ? totalAmount / Math.max(registration.participantCount, 1) : 0
    }]
  });

  const generated = await generateInvoicePdf(updated.id, false);
  await prisma.registration.update({
    where: { id: registration.id },
    data: { invoiceUrl: generated.pdfUrl ?? undefined }
  });
  return generated;
}

function participantChangeRow(participant: { id: string; firstName: string; lastName: string; email: string }) {
  return {
    participantId: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    email: participant.email.toLowerCase()
  };
}

export async function syncRegistrationParticipantListStatus(registrationId: string) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      participants: {
        where: { status: ParticipantStatus.REGISTERED },
        select: { title: true }
      },
      _count: {
        select: { participants: { where: { status: ParticipantStatus.REGISTERED } } }
      }
    }
  });

  if (!registration) {
    return;
  }

  const actualCount = registration._count.participants;
  const missingTitleCount = countParticipantsMissingTitles(registration.participants);
  const status = deriveParticipantListStatus(registration.participantCount, actualCount);

  await prisma.registration.update({
    where: { id: registrationId },
    data: { participantListStatus: status }
  });

  if (status === ParticipantListStatus.COMPLETE) {
    await prisma.operationsTask.updateMany({
      where: {
        registrationId,
        category: OperationsTaskCategory.PARTICIPANT_LIST,
        status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
      },
      data: {
        status: OperationsTaskStatus.COMPLETED,
        completedAt: new Date(),
        description: `Roster completed automatically at ${actualCount}/${registration.participantCount || actualCount} participants.`
      }
    });
  } else if (status === ParticipantListStatus.NEEDED || status === ParticipantListStatus.PARTIAL) {
    await prisma.operationsTask.updateMany({
      where: {
        registrationId,
        category: OperationsTaskCategory.PARTICIPANT_LIST,
        status: OperationsTaskStatus.COMPLETED
      },
      data: {
        status: OperationsTaskStatus.OPEN,
        completedAt: null,
        description: status === ParticipantListStatus.PARTIAL
            ? `Roster is partial at ${actualCount}/${registration.participantCount} participants.`
            : "Registration still needs a participant roster."
      }
    });
  }

  return { status, actualCount, expectedCount: registration.participantCount, missingTitleCount };
}

export async function addParticipant(input: z.input<typeof participantCreateSchema>, options: ParticipantMutationOptions = {}) {
  const data = participantCreateSchema.parse(input);
  const duplicate = await prisma.participant.findFirst({
    where: { registrationId: data.registrationId, email: { equals: data.email, mode: "insensitive" } }
  });
  if (duplicate) {
    throw Object.assign(new Error("This email is already saved on the registration roster."), { code: "CONFLICT", status: 409 });
  }
  const participant = await prisma.participant.create({ data });
  logAuditEventAsync({
    entityType: "Participant",
    entityId: participant.id,
    action: "ADDED",
    description: "Participant added",
    metadata: { cohortId: participant.cohortId, registrationId: participant.registrationId }
  });
  await syncRegistrationParticipantListStatus(participant.registrationId);
  void queueParticipantCrmSync(participant.id, "participant.created").catch(() => undefined);
  void syncRegistrationToCrm(participant.registrationId, { eventType: "participant.created" }).catch((error) => {
    console.error("CRM Mission Cohort webhook scheduling failed", { registrationId: participant.registrationId, error: error instanceof Error ? error.message : "Unknown error" });
  });
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: participant.registrationId }, include: { cohort: true } });
  if (options.deferNotifications && shouldDeferRegistrationDelivery(registration.cohort.status)) {
    await stageParticipantAddition(participant.registrationId, participantChangeRow(participant));
    return { ...participant, journey: { status: "pending_apply" as const } };
  }
  const journey = await planRegistrationJourneys(participant.registrationId);
  return { ...participant, journey };
}

export async function updateParticipant(id: string, input: z.input<typeof participantUpdateSchema>, options: ParticipantMutationOptions = {}) {
  const data = participantUpdateSchema.parse(input);
  const existing = await prisma.participant.findUniqueOrThrow({ where: { id } });
  const participant = await prisma.participant.update({ where: { id }, data });
  await syncRegistrationParticipantListStatus(participant.registrationId);
  void queueParticipantCrmSync(participant.id, "participant.updated").catch(() => undefined);
  void syncRegistrationToCrm(participant.registrationId, { eventType: "participant.updated" }).catch((error) => {
    console.error("CRM Mission Cohort webhook scheduling failed", { registrationId: participant.registrationId, error: error instanceof Error ? error.message : "Unknown error" });
  });
  if (existing.email.toLowerCase() !== participant.email.toLowerCase() || participant.status !== ParticipantStatus.REGISTERED) {
    await cancelParticipantJourneys([participant.id], participant.status !== ParticipantStatus.REGISTERED ? "Participant is no longer registered." : "Participant email changed.");
  }
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: participant.registrationId }, include: { cohort: true } });
  if (options.deferNotifications && shouldDeferRegistrationDelivery(registration.cohort.status)) {
    if (existing.status === ParticipantStatus.REGISTERED && participant.status !== ParticipantStatus.REGISTERED) {
      await stageParticipantRemoval(participant.registrationId, participantChangeRow(existing));
    } else if (existing.status !== ParticipantStatus.REGISTERED && participant.status === ParticipantStatus.REGISTERED) {
      await stageParticipantAddition(participant.registrationId, participantChangeRow(participant));
    } else if (existing.email.toLowerCase() !== participant.email.toLowerCase()) {
      await stageParticipantRemoval(participant.registrationId, participantChangeRow(existing));
      await stageParticipantAddition(participant.registrationId, participantChangeRow(participant));
    }
    return { ...participant, journey: { status: "pending_apply" as const } };
  }
  const journey = await planRegistrationJourneys(participant.registrationId);
  return { ...participant, journey };
}

export async function removeParticipant(id: string, options: ParticipantMutationOptions = {}) {
  const existing = await prisma.participant.findUniqueOrThrow({ where: { id }, include: { registration: { include: { cohort: true } } } });
  await cancelParticipantJourneys([id], "Participant removed from registration.");
  const participant = await prisma.participant.delete({ where: { id } });
  await syncRegistrationParticipantListStatus(participant.registrationId);
  void syncRemovedParticipantToCrm({ ...existing, registrationId: existing.registrationId }).catch((error) => {
    console.error("CRM Mission Cohort webhook scheduling failed", { registrationId: existing.registrationId, error: error instanceof Error ? error.message : "Unknown error" });
  });
  if (options.deferNotifications && shouldDeferRegistrationDelivery(existing.registration.cohort.status)) {
    await stageParticipantRemoval(participant.registrationId, participantChangeRow(existing));
  }
  return participant;
}

export async function bulkMoveParticipantsToCohort(input: { ids: string[]; targetCohortId: string }) {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  const targetCohortId = String(input.targetCohortId ?? "").trim();

  if (ids.length === 0) {
    return { count: 0, summary: summarizeBulkParticipantMove([], targetCohortId), targetCohort: null };
  }

  if (!targetCohortId) {
    throw Object.assign(new Error("targetCohortId is required"), { code: "BAD_REQUEST", status: 400 });
  }

  const [targetCohort, participants] = await Promise.all([
    prisma.cohort.findUnique({ where: { id: targetCohortId }, select: { id: true, title: true, pricePerParticipant: true } }),
    prisma.participant.findMany({
      where: { id: { in: ids } },
      include: {
        registration: {
          include: {
            cohort: true,
            paymentRecords: { orderBy: { createdAt: "desc" } },
            invoiceDrafts: {
              where: { status: { notIn: [InvoiceDraftStatus.VOIDED, InvoiceDraftStatus.CANCELLED] } },
              orderBy: { updatedAt: "desc" },
              include: { lineItems: true }
            }
          }
        },
        organization: true
      }
    })
  ]);

  if (!targetCohort) {
    throw Object.assign(new Error("Target cohort not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (participants.length !== ids.length) {
    const found = new Set(participants.map((participant) => participant.id));
    const missing = ids.filter((id) => !found.has(id));
    throw Object.assign(new Error(`Participant${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}`), {
      code: "NOT_FOUND",
      status: 404
    });
  }

  const summary = summarizeBulkParticipantMove(participants, targetCohortId);
  const movingParticipants = participants.filter((participant) => participant.cohortId !== targetCohortId);
  const nonRegistered = movingParticipants.filter((participant) => participant.status !== ParticipantStatus.REGISTERED);

  if (nonRegistered.length > 0) {
    throw Object.assign(new Error("Only registered participants can be moved between cohorts."), { code: "BAD_REQUEST", status: 400 });
  }

  if (movingParticipants.length === 0) {
    return { count: 0, summary, targetCohort, targetRegistrations: [], confirmationsSent: 0, confirmationFailures: 0 };
  }

  const movingEmails = Array.from(new Set(movingParticipants.map((participant) => participant.email.trim().toLowerCase()).filter(Boolean)));
  const existingTargetEmails = movingEmails.length
    ? await prisma.participant.findMany({
        where: {
          cohortId: targetCohortId,
          status: ParticipantStatus.REGISTERED,
          id: { notIn: movingParticipants.map((participant) => participant.id) },
          OR: movingEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }))
        },
        select: { email: true }
      })
    : [];

  if (existingTargetEmails.length > 0) {
    const emails = Array.from(new Set(existingTargetEmails.map((participant) => participant.email.toLowerCase()))).sort();
    throw Object.assign(new Error(`Target cohort already has registered participant${emails.length === 1 ? "" : "s"} with: ${emails.join(", ")}`), {
      code: "CONFLICT",
      status: 409
    });
  }

  await cancelParticipantJourneys(movingParticipants.map((participant) => participant.id), `Participant moved to ${targetCohort.title}.`);

  const byRegistration = new Map<string, typeof movingParticipants>();
  for (const participant of movingParticipants) {
    byRegistration.set(participant.registrationId, [...(byRegistration.get(participant.registrationId) ?? []), participant]);
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    const targetRegistrations = [];

    for (const [sourceRegistrationId, group] of byRegistration.entries()) {
      const sourceRegistration = group[0]!.registration;
      const existingTargetRegistration = await tx.registration.findFirst({
        where: {
          cohortId: targetCohortId,
          organizationId: sourceRegistration.organizationId,
          primaryContactEmail: { equals: sourceRegistration.primaryContactEmail, mode: "insensitive" },
          source: "participant_move",
          notes: { contains: sourceRegistrationId }
        },
        include: {
          paymentRecords: { orderBy: { createdAt: "desc" } }
        },
        orderBy: { createdAt: "asc" }
      });
      const sourceTotalBefore = moneyNumber(sourceRegistration.totalAmount);
      const sourcePaidBefore = registrationPaidAmount(sourceRegistration);
      const sourceCountBefore = Math.max(Number(sourceRegistration.participantCount ?? 0), group.length);
      const configuredTargetUnitAmount = moneyNumber(targetCohort.pricePerParticipant);
      const targetUnitAmount = configuredTargetUnitAmount > 0
        ? configuredTargetUnitAmount
        : moneyNumber(sourceCountBefore ? sourceTotalBefore / sourceCountBefore : 0);
      const finance = calculatePartialParticipantMoveFinance({
        sourceTotalAmount: sourceTotalBefore,
        sourcePaidAmount: sourcePaidBefore,
        sourceParticipantCount: sourceCountBefore,
        movedCount: group.length,
        targetUnitAmount,
        sourcePaymentStatus: sourceRegistration.paymentStatus as PaymentStatus
      });
      const existingTargetPaid = existingTargetRegistration ? registrationPaidAmount(existingTargetRegistration) : 0;
      const nextTargetTotal = moneyNumber(Number(existingTargetRegistration?.totalAmount ?? 0) + finance.targetTotalAmount);
      const nextTargetPaid = moneyNumber(existingTargetPaid + finance.targetPaidAmount);
      const targetRegistration = existingTargetRegistration
        ? await tx.registration.update({
            where: { id: existingTargetRegistration.id },
            data: {
              participantCount: Number(existingTargetRegistration.participantCount ?? 0) + group.length,
              totalAmount: nextTargetTotal,
              paymentMethod: nextTargetPaid > 0 ? sourceRegistration.paymentMethod : existingTargetRegistration.paymentMethod,
              paymentStatus: paymentStatusForAmount(nextTargetTotal, nextTargetPaid, existingTargetRegistration.paymentStatus as PaymentStatus),
              notes: [
                existingTargetRegistration.notes,
                `Added ${group.length} moved participant${group.length === 1 ? "" : "s"} from source registration ${sourceRegistrationId}.`
              ].filter(Boolean).join(" ")
            }
          })
        : await tx.registration.create({
            data: {
              cohortId: targetCohortId,
              organizationId: sourceRegistration.organizationId,
              primaryContactName: sourceRegistration.primaryContactName,
              primaryContactEmail: sourceRegistration.primaryContactEmail,
              primaryContactPhone: sourceRegistration.primaryContactPhone,
              primaryContactTitle: sourceRegistration.primaryContactTitle,
              billingContactName: sourceRegistration.billingContactName,
              billingContactEmail: sourceRegistration.billingContactEmail,
              billingAddress: sourceRegistration.billingAddress,
              paymentMethod: finance.targetPaidAmount > 0 ? sourceRegistration.paymentMethod : PaymentMethod.INVOICE,
              paymentStatus: finance.targetPaymentStatus,
              participantListStatus: ParticipantListStatus.COMPLETE,
              supportingDocumentStatus: SupportingDocumentStatus.READY,
              participantCount: group.length,
              totalAmount: finance.targetTotalAmount,
              status: RegistrationStatus.CONFIRMED,
              source: "participant_move",
              notes: [
                `Created by moving ${group.length} participant${group.length === 1 ? "" : "s"} from ${sourceRegistration.cohort.title}.`,
                finance.targetPaidAmount > 0
                  ? `Moved ${finance.targetPaidAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })} of paid value from source registration ${sourceRegistrationId}.`
                  : `Invoice value was split from source registration ${sourceRegistrationId}.`
              ].join(" ")
            }
          });

      if (finance.targetPaidAmount > 0) {
        await tx.paymentRecord.create({
          data: {
            registrationId: targetRegistration.id,
            cohortId: targetCohortId,
            organizationId: sourceRegistration.organizationId,
            amount: finance.targetPaidAmount,
            status: PaymentStatus.PAID,
            method: sourceRegistration.paymentMethod,
            paymentDate: new Date(),
            notes: `Paid value moved from source registration ${sourceRegistrationId}.`
          }
        });
        await reducePaidPaymentRecords(tx, sourceRegistration.paymentRecords, finance.targetPaidAmount);
      }

      await tx.participant.updateMany({
        where: { id: { in: group.map((participant) => participant.id) } },
        data: {
          registrationId: targetRegistration.id,
          cohortId: targetCohortId,
          organizationId: sourceRegistration.organizationId
        }
      });

      await tx.registration.update({
        where: { id: sourceRegistrationId },
        data: {
          participantCount: finance.remainingCount,
          totalAmount: finance.sourceTotalAfter,
          paymentStatus: finance.sourcePaymentStatus
        }
      });

      targetRegistrations.push({
        id: targetRegistration.id,
        sourceRegistrationId,
        sourceCohortId: sourceRegistration.cohortId,
        targetTotalAmount: finance.targetTotalAmount,
        targetPaidAmount: finance.targetPaidAmount,
        sourceTotalAfter: finance.sourceTotalAfter,
        sourcePaidAfter: finance.sourcePaidAfter,
        movedParticipantIds: group.map((participant) => participant.id),
        movedParticipantEmails: group.map((participant) => participant.email)
      });
    }

    return { targetRegistrations };
  });

  for (const sourceRegistrationId of summary.sourceRegistrationIds) {
    await syncRegistrationParticipantListStatus(sourceRegistrationId);
    await refreshSplitSourceInvoice(sourceRegistrationId);
    void queueRegistrationCrmSync(sourceRegistrationId, "participant.moved_out").catch(() => undefined);
    void syncRegistrationToCrm(sourceRegistrationId, { eventType: "participant.moved_out" }).catch(() => undefined);
  }

  const moveConfirmationBatchKey = randomUUID();
  const journeyResults = [];
  for (const targetRegistration of transactionResult.targetRegistrations) {
    await syncRegistrationParticipantListStatus(targetRegistration.id);
    await prepareMovedRegistrationInvoice(targetRegistration.id);
    void queueRegistrationCrmSync(targetRegistration.id, "participant.moved_in").catch(() => undefined);
    void syncRegistrationToCrm(targetRegistration.id, { eventType: "participant.moved_in" }).catch(() => undefined);
    for (const participantId of targetRegistration.movedParticipantIds) {
      logAuditEventAsync({
        entityType: "Participant",
        entityId: participantId,
        action: "MOVED_COHORT",
        description: `Participant moved to ${targetCohort.title}`,
        metadata: {
          sourceRegistrationId: targetRegistration.sourceRegistrationId,
          targetRegistrationId: targetRegistration.id,
          sourceCohortId: targetRegistration.sourceCohortId,
          targetCohortId
        }
      });
      void queueParticipantCrmSync(participantId, "participant.moved").catch(() => undefined);
    }
    journeyResults.push(await planRegistrationJourneys(targetRegistration.id, {
      sendPocConfirmation: true,
      participantEmails: targetRegistration.movedParticipantEmails,
      retryFailed: true,
      participantConfirmationCohortScoped: true,
      participantConfirmationBatchKey: moveConfirmationBatchKey,
      pocConfirmationCohortScoped: true,
      pocConfirmationBatchKey: moveConfirmationBatchKey,
      bypassCohortStatusForImmediate: true,
      calendarSendUpdates: false
    }));
  }

  const sourceCalendarSync = [];
  for (const sourceCohortId of summary.sourceCohortIds) {
    sourceCalendarSync.push(await syncFutureLinkedGoogleCalendarInvitesForCohort(sourceCohortId, { sendUpdates: false }));
  }
  const targetCalendarSync = await syncFutureLinkedGoogleCalendarInvitesForCohort(targetCohortId, { sendUpdates: false });

  return {
    count: movingParticipants.length,
    summary,
    targetCohort,
    targetRegistrations: transactionResult.targetRegistrations,
    sourceCalendarSync,
    targetCalendarSync,
    confirmationsSent: journeyResults.reduce((total, result) => total + Number(result.sent ?? 0), 0),
    confirmationFailures: journeyResults.reduce((total, result) => total + Number(result.failed ?? 0), 0)
  };
}

export async function listParticipantsByCohort(cohortId: string) {
  const participants = await prisma.participant.findMany({
    where: { cohortId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { organization: true, registration: { include: { paymentRecords: true } } }
  });
  const summaries = await getRecipientCommunicationSummary(participants.map((participant) => participant.email));

  return participants.map((participant) => ({
    ...participant,
    emailSummary: summaries[participant.email.toLowerCase()]
  }));
}

export async function listParticipants() {
  const participants = await prisma.participant.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { cohort: true, organization: true, registration: { include: { paymentRecords: true } } }
  });
  const summaries = await getRecipientCommunicationSummary(participants.map((participant) => participant.email));

  return participants.map((participant) => ({
    ...participant,
    emailSummary: summaries[participant.email.toLowerCase()]
  }));
}

export async function listParticipantHistorySummaries() {
  return prisma.participant.findMany({
    orderBy: [{ email: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      createdAt: true,
      cohort: { select: { id: true, title: true, slug: true, shortName: true, status: true } },
      organization: { select: { id: true, name: true } }
    }
  });
}
