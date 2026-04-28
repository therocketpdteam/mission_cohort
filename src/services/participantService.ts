import { ParticipantListStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { participantCreateSchema, participantUpdateSchema } from "@/validators/participant";
import { logAuditEventAsync } from "./auditService";

async function syncRegistrationParticipantListStatus(registrationId: string) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { _count: { select: { participants: true } } }
  });

  if (!registration) {
    return;
  }

  const actualCount = registration._count.participants;
  const status =
    registration.participantCount === 0 && actualCount === 0
      ? ParticipantListStatus.NOT_REQUESTED
      : registration.participantCount === 0 || actualCount >= registration.participantCount
        ? ParticipantListStatus.COMPLETE
        : actualCount > 0
          ? ParticipantListStatus.PARTIAL
          : ParticipantListStatus.NEEDED;

  await prisma.registration.update({
    where: { id: registrationId },
    data: { participantListStatus: status }
  });
}

export async function addParticipant(input: z.input<typeof participantCreateSchema>) {
  const data = participantCreateSchema.parse(input);
  const participant = await prisma.participant.create({ data });
  logAuditEventAsync({
    entityType: "Participant",
    entityId: participant.id,
    action: "ADDED",
    description: "Participant added",
    metadata: { cohortId: participant.cohortId, registrationId: participant.registrationId }
  });
  void syncRegistrationParticipantListStatus(participant.registrationId);
  return participant;
}

export async function updateParticipant(id: string, input: z.input<typeof participantUpdateSchema>) {
  const data = participantUpdateSchema.parse(input);
  return prisma.participant.update({ where: { id }, data });
}

export async function removeParticipant(id: string) {
  const participant = await prisma.participant.delete({ where: { id } });
  void syncRegistrationParticipantListStatus(participant.registrationId);
  return participant;
}

export async function listParticipantsByCohort(cohortId: string) {
  return prisma.participant.findMany({
    where: { cohortId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { organization: true, registration: true }
  });
}

export async function listParticipants() {
  return prisma.participant.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { cohort: true, organization: true }
  });
}
