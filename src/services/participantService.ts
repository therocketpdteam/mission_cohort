import { OperationsTaskCategory, OperationsTaskStatus, ParticipantListStatus, ParticipantStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { countParticipantsMissingTitles, deriveParticipantListStatus } from "@/lib/rosterStatus";
import { participantCreateSchema, participantUpdateSchema } from "@/validators/participant";
import { logAuditEventAsync } from "./auditService";
import { queueParticipantCrmSync } from "./crmSyncService";
import { getRecipientCommunicationSummary } from "./communicationService";
import { cancelParticipantJourneys, planRegistrationJourneys } from "./registrationJourneyService";
import { shouldDeferRegistrationDelivery, stageParticipantAddition, stageParticipantRemoval } from "./registrationChangeService";

type ParticipantMutationOptions = { deferNotifications?: boolean };

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
  const status = deriveParticipantListStatus(registration.participantCount, actualCount, missingTitleCount);

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
        description: `Roster completed automatically at ${actualCount}/${registration.participantCount || actualCount} participants with titles.`
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
        description: missingTitleCount > 0
          ? `Roster is missing ${missingTitleCount} participant title${missingTitleCount === 1 ? "" : "s"}.`
          : status === ParticipantListStatus.PARTIAL
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
  if (options.deferNotifications && shouldDeferRegistrationDelivery(existing.registration.cohort.status)) {
    await stageParticipantRemoval(participant.registrationId, participantChangeRow(existing));
  }
  return participant;
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
