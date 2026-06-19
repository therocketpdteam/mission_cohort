import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionCreateSchema, sessionUpdateSchema } from "@/validators/session";
import { logAuditEventAsync } from "./auditService";
import { createDefaultSessionOperationsTasks } from "./operationsTaskService";
import { createCalendarInvitePlaceholder } from "./calendarService";
import { rescheduleUnsentSessionCommunications, sendCalendarUpdateNotice } from "./communicationService";

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
  void createDefaultSessionOperationsTasks({
    cohortId: session.cohortId,
    sessionId: session.id,
    sessionTitle: session.title
  });
  return session;
}

export async function updateSession(id: string, input: z.input<typeof sessionUpdateSchema>) {
  const data = sessionUpdateSchema.parse(input);
  const existingSession = await prisma.cohortSession.findUnique({ where: { id } });

  if (!existingSession) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  const linkedGoogleEvent = await prisma.calendarEvent.findFirst({ where: { sessionId: id, provider: "google" } });
  const session = await prisma.cohortSession.update({ where: { id }, data });
  const detailsChanged = calendarDetailsChanged(existingSession, session);
  const reminderSync = existingSession.startTime.getTime() !== session.startTime.getTime()
    ? await rescheduleUnsentSessionCommunications(id, session.startTime)
    : { updated: 0 };

  if (!linkedGoogleEvent || !detailsChanged) {
    return { ...session, calendarSync: linkedGoogleEvent ? "unchanged" as const : "not_linked" as const, reminderSync };
  }

  let calendarResult: Awaited<ReturnType<typeof createCalendarInvitePlaceholder>> | null = null;
  let calendarSyncError: string | null = null;
  try {
    calendarResult = await createCalendarInvitePlaceholder(id, "google");
  } catch (error) {
    calendarSyncError = error instanceof Error ? error.message : "Google Calendar update failed";
  }

  let emailSync: "sent" | "blocked" = "sent";
  let emailSyncError: string | null = null;
  try {
    await sendCalendarUpdateNotice({ cohortId: session.cohortId, sessionId: session.id });
  } catch (error) {
    emailSync = "blocked";
    emailSyncError = error instanceof Error ? error.message : "Session update email failed";
  }

  return {
    ...session,
    calendarSync: calendarResult ? "updated" as const : "blocked" as const,
    calendarRecipients: calendarResult?.attendeeCount ?? 0,
    calendarSyncError,
    reminderSync,
    emailSync,
    emailSyncError
  };
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
