import { randomUUID } from "node:crypto";
import { OperationsTaskCategory, OperationsTaskStatus, ParticipantListStatus, ParticipantStatus, PaymentMethod, PaymentStatus, RegistrationStatus, SupportingDocumentStatus } from "@prisma/client";
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
    prisma.cohort.findUnique({ where: { id: targetCohortId }, select: { id: true, title: true } }),
    prisma.participant.findMany({
      where: { id: { in: ids } },
      include: {
        registration: { include: { cohort: true } },
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
      const targetRegistration = await tx.registration.create({
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
          paymentMethod: PaymentMethod.COMPED,
          paymentStatus: PaymentStatus.PAID,
          participantListStatus: ParticipantListStatus.COMPLETE,
          supportingDocumentStatus: SupportingDocumentStatus.READY,
          participantCount: group.length,
          totalAmount: 0,
          status: RegistrationStatus.CONFIRMED,
          source: "participant_move",
          notes: [
            `Created by moving ${group.length} participant${group.length === 1 ? "" : "s"} from ${sourceRegistration.cohort.title}.`,
            `Finance and QuickBooks references remain on source registration ${sourceRegistrationId}.`
          ].join(" ")
        }
      });

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
          participantCount: Math.max(0, Number(sourceRegistration.participantCount ?? 0) - group.length)
        }
      });

      targetRegistrations.push({
        id: targetRegistration.id,
        sourceRegistrationId,
        sourceCohortId: sourceRegistration.cohortId,
        movedParticipantIds: group.map((participant) => participant.id),
        movedParticipantEmails: group.map((participant) => participant.email)
      });
    }

    return { targetRegistrations };
  });

  for (const sourceRegistrationId of summary.sourceRegistrationIds) {
    await syncRegistrationParticipantListStatus(sourceRegistrationId);
    void queueRegistrationCrmSync(sourceRegistrationId, "participant.moved_out").catch(() => undefined);
    void syncRegistrationToCrm(sourceRegistrationId, { eventType: "participant.moved_out" }).catch(() => undefined);
  }

  const moveConfirmationBatchKey = randomUUID();
  const journeyResults = [];
  for (const targetRegistration of transactionResult.targetRegistrations) {
    await syncRegistrationParticipantListStatus(targetRegistration.id);
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
      sendPocConfirmation: false,
      participantEmails: targetRegistration.movedParticipantEmails,
      retryFailed: true,
      participantConfirmationCohortScoped: true,
      participantConfirmationBatchKey: moveConfirmationBatchKey,
      bypassCohortStatusForImmediate: true
    }));
  }

  const sourceCalendarSync = [];
  for (const sourceCohortId of summary.sourceCohortIds) {
    sourceCalendarSync.push(await syncFutureLinkedGoogleCalendarInvitesForCohort(sourceCohortId));
  }
  const targetCalendarSync = await syncFutureLinkedGoogleCalendarInvitesForCohort(targetCohortId);

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
