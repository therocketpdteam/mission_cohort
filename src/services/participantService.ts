import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { participantCreateSchema, participantUpdateSchema } from "@/validators/participant";
import { logAuditEventAsync } from "./auditService";

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
  return participant;
}

export async function updateParticipant(id: string, input: z.input<typeof participantUpdateSchema>) {
  const data = participantUpdateSchema.parse(input);
  return prisma.participant.update({ where: { id }, data });
}

export async function removeParticipant(id: string) {
  return prisma.participant.delete({ where: { id } });
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
