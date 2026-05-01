import { CalendarInviteStatus, IntegrationConnectionStatus, IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exchangeGoogleCalendarCode, generateSessionIcs, getGoogleCalendarConnectUrl, upsertGoogleCalendarEvent } from "@/modules/calendar";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";

export function getGoogleCalendarOAuthUrl() {
  return getGoogleCalendarConnectUrl();
}

export async function completeGoogleCalendarOAuth(code: string) {
  const token = await exchangeGoogleCalendarCode(code);
  return upsertIntegrationConnection({
    provider: IntegrationProvider.GOOGLE_CALENDAR,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "RocketPD Operations Calendar",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    metadata: { scope: token.scope ?? null, tokenType: token.token_type ?? null }
  });
}

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
    const connection = await getDecryptedIntegrationConnection(IntegrationProvider.GOOGLE_CALENDAR);
    const existing = await prisma.calendarEvent.findFirst({
      where: { sessionId: session.id, provider: "google" },
      orderBy: { createdAt: "desc" }
    });
    const result = await upsertGoogleCalendarEvent({
      title: session.title,
      description: session.description ?? undefined,
      startTime: session.startTime,
      endTime: session.endTime,
      timezone: session.timezone,
      meetingUrl: session.meetingUrl,
      location: session.location,
      accessToken: connection?.accessToken,
      providerEventId: existing?.providerEventId
    });

    const calendarEvent = existing
      ? await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: {
            providerEventId: result.id,
            title: session.title,
            startTime: session.startTime,
            endTime: session.endTime,
            timezone: session.timezone,
            inviteUrl: session.meetingUrl,
            htmlLink: result.htmlLink,
            status: CalendarInviteStatus.UPDATED
          }
        })
      : await prisma.calendarEvent.create({
          data: {
            cohortId: session.cohortId,
            sessionId: session.id,
            provider: "google",
            providerEventId: result.id,
            title: session.title,
            startTime: session.startTime,
            endTime: session.endTime,
            timezone: session.timezone,
            inviteUrl: session.meetingUrl,
            htmlLink: result.htmlLink,
            status: CalendarInviteStatus.CREATED
          }
        });

    await prisma.cohortSession.update({
      where: { id: session.id },
      data: { calendarInviteStatus: CalendarInviteStatus.CREATED }
    });

    return { provider: "google", status: "created", event: calendarEvent };
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
