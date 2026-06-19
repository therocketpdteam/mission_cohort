import { z } from "zod";
import { CalendarInviteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sessionCreateSchema, sessionUpdateSchema } from "@/validators/session";
import { logAuditEventAsync } from "./auditService";
import { createDefaultSessionCommunications, rescheduleUnsentSessionCommunications } from "./communicationService";

const calendarRelevantFields = ["title", "description", "startTime", "endTime", "timezone", "meetingUrl", "location"] as const;

function calendarDetailsChanged(
  before: Record<(typeof calendarRelevantFields)[number], unknown>,
  after: Record<(typeof calendarRelevantFields)[number], unknown>
) {
  return calendarRelevantFields.some((field) => {
    const beforeValue = before[field] instanceof Date ? (before[field] as Date).getTime() : before[field] ?? "";
    const afterValue = after[field] instanceof Date ? (after[field] as Date).getTime() : after[field] ?? "";
    return beforeValue !== afterValue;
  });
}

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
  await createDefaultSessionCommunications(session.id);
  return session;
}

export async function updateSession(id: string, input: z.input<typeof sessionUpdateSchema>) {
  const data = sessionUpdateSchema.parse(input);
  const existingSession = await prisma.cohortSession.findUnique({ where: { id } });

  if (!existingSession) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const linkedGoogleEvent = await prisma.calendarEvent.findFirst({ where: { sessionId: id, provider: "google" } });
  let session = await prisma.cohortSession.update({ where: { id }, data });
  const detailsChanged = calendarDetailsChanged(existingSession, session);
  const reminderSync = existingSession.startTime.getTime() !== session.startTime.getTime()
    ? await rescheduleUnsentSessionCommunications(id, session.startTime)
    : { updated: 0 };

  if (!linkedGoogleEvent || !detailsChanged) {
    return { ...session, calendarSync: linkedGoogleEvent ? "unchanged" as const : "not_linked" as const, reminderSync };
  }

  session = await prisma.cohortSession.update({
    where: { id },
    data: { calendarInviteStatus: CalendarInviteStatus.NOT_CREATED }
  });

  return { ...session, calendarSync: "pending" as const, reminderSync };
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
