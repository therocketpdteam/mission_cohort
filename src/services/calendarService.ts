import { CalendarInviteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createGoogleCalendarEventPlaceholder, generateSessionIcs } from "@/modules/calendar";

export async function createCalendarInvitePlaceholder(sessionId?: string, mode: "google" | "ics" = "ics") {
  if (!sessionId) {
    return { status: "session_required", provider: mode };
  }

  const session = await prisma.cohortSession.findUnique({
    where: { id: sessionId },
    include: { cohort: true }
  });

  if (!session) {
    throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (mode === "google") {
    const result = await createGoogleCalendarEventPlaceholder({
      title: session.title,
      description: session.description ?? undefined,
      startTime: session.startTime,
      endTime: session.endTime,
      timezone: session.timezone,
      meetingUrl: session.meetingUrl,
      location: session.location
    });

    await prisma.calendarEvent.create({
      data: {
        cohortId: session.cohortId,
        sessionId: session.id,
        provider: "google",
        title: session.title,
        startTime: session.startTime,
        endTime: session.endTime,
        timezone: session.timezone,
        status: CalendarInviteStatus.NOT_CREATED
      }
    });

    return result;
  }

  const ics = generateSessionIcs(session);
  await prisma.calendarEvent.create({
    data: {
      cohortId: session.cohortId,
      sessionId: session.id,
      provider: "ics",
      title: session.title,
      startTime: session.startTime,
      endTime: session.endTime,
      timezone: session.timezone,
      inviteUrl: session.meetingUrl,
      status: CalendarInviteStatus.CREATED
    }
  });

  await prisma.cohortSession.update({
    where: { id: session.id },
    data: { calendarInviteStatus: CalendarInviteStatus.CREATED }
  });

  return {
    provider: "ics",
    status: "created",
    ics
  };
}
