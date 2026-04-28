import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionCreateSchema, sessionUpdateSchema } from "@/validators/session";
import { logAuditEventAsync } from "./auditService";

export async function createSession(input: z.input<typeof sessionCreateSchema>) {
  const data = sessionCreateSchema.parse(input);
  const session = await prisma.cohortSession.create({ data });
  logAuditEventAsync({
    entityType: "CohortSession",
    entityId: session.id,
    action: "CREATED",
    description: "Session created",
    metadata: { cohortId: session.cohortId, sessionNumber: session.sessionNumber }
  });
  return session;
}

export async function updateSession(id: string, input: z.input<typeof sessionUpdateSchema>) {
  const data = sessionUpdateSchema.parse(input);
  return prisma.cohortSession.update({ where: { id }, data });
}

export async function deleteSession(id: string) {
  return prisma.cohortSession.delete({ where: { id } });
}

export async function listSessionsByCohort(cohortId: string) {
  return prisma.cohortSession.findMany({
    where: { cohortId },
    orderBy: { sessionNumber: "asc" }
  });
}
