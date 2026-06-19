import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionCreateSchema, sessionUpdateSchema } from "@/validators/session";
import { logAuditEventAsync } from "./auditService";
import { createDefaultSessionOperationsTasks } from "./operationsTaskService";
import { createCalendarInvitePlaceholder } from "./calendarService";

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
  void createDefaultSessionOperationsTasks({
    cohortId: session.cohortId,
    sessionId: session.id,
    sessionTitle: session.title
  });
  return session;
}

export async function updateSession(id: string, input: z.input<typeof sessionUpdateSchema>) {
  const data = sessionUpdateSchema.parse(input);
  const linkedGoogleEvent = await prisma.calendarEvent.findFirst({ where: { sessionId: id, provider: "google" } });
  const session = await prisma.cohortSession.update({ where: { id }, data });

  if (!linkedGoogleEvent) {
    return { ...session, calendarSync: "not_linked" as const };
  }

  try {
    const result = await createCalendarInvitePlaceholder(id, "google");
    return { ...session, calendarSync: "updated" as const, calendarRecipients: result.attendeeCount ?? 0 };
  } catch (error) {
    return {
      ...session,
      calendarSync: "blocked" as const,
      calendarSyncError: error instanceof Error ? error.message : "Google Calendar update failed"
    };
  }
}

export async function deleteSession(id: string) {
  return prisma.cohortSession.delete({ where: { id } });
}

export async function listSessionsByCohort(cohortId: string) {
  return prisma.cohortSession.findMany({
    where: { cohortId },
    orderBy: { sessionNumber: "asc" },
    include: { calendarEvents: true }
  });
}
