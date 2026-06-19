import { CalendarInviteStatus, IntegrationConnectionStatus, IntegrationProvider, OperationsTaskCategory, OperationsTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exchangeGoogleCalendarCode, generateSessionIcs, getGoogleCalendarConnectUrl, upsertGoogleCalendarEvent } from "@/modules/calendar";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";
import { resolveGoogleCalendarSetup } from "@/services/integrationSetupService";

async function googleSetupWithEnvFallback() {
  const setup = await resolveGoogleCalendarSetup();

  return {
    clientId: setup.clientId || undefined,
    clientSecret: setup.clientSecret || undefined,
    redirectUri: setup.redirectUri || undefined,
    calendarId: setup.calendarId || undefined
  };
}

export async function getGoogleCalendarOAuthUrl() {
  return getGoogleCalendarConnectUrl("mission-control", await googleSetupWithEnvFallback());
}

export async function completeGoogleCalendarOAuth(code: string) {
  const setup = await googleSetupWithEnvFallback();
  const token = await exchangeGoogleCalendarCode(code, setup);
  return upsertIntegrationConnection({
    provider: IntegrationProvider.GOOGLE_CALENDAR,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "RocketPD Operations Calendar",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    metadata: { scope: token.scope ?? null, tokenType: token.token_type ?? null, calendarId: setup.calendarId ?? null }
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

  try {
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
        calendarId: (await googleSetupWithEnvFallback()).calendarId,
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

      await prisma.operationsTask.updateMany({
        where: {
          sessionId: session.id,
          category: OperationsTaskCategory.CALENDAR_INVITE,
          status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
        },
        data: { status: OperationsTaskStatus.COMPLETED, completedAt: new Date() }
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

    await prisma.operationsTask.updateMany({
      where: {
        sessionId: session.id,
        category: OperationsTaskCategory.CALENDAR_INVITE,
        status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
      },
      data: { status: OperationsTaskStatus.COMPLETED, completedAt: new Date() }
    });

    return {
      provider: "ics",
      status: "created",
      ics
    };
  } catch (error) {
    await prisma.cohortSession.update({
      where: { id: session.id },
      data: { calendarInviteStatus: CalendarInviteStatus.FAILED }
    });
    throw error;
  }
}

export async function prepareCohortCalendarInvites(input: { cohortId?: string; mode?: "google" | "ics"; fallbackToIcs?: boolean }) {
  if (!input.cohortId) {
    throw Object.assign(new Error("cohortId is required"), { code: "BAD_REQUEST", status: 400 });
  }

  const sessions = await prisma.cohortSession.findMany({
    where: { cohortId: input.cohortId },
    orderBy: { startTime: "asc" }
  });
  const mode = input.mode ?? "ics";
  const results = [];

  for (const session of sessions) {
    try {
      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        ...(await createCalendarInvitePlaceholder(session.id, mode))
      });
    } catch (error) {
      if (mode === "google" && input.fallbackToIcs !== false) {
        try {
          results.push({
            sessionId: session.id,
            sessionTitle: session.title,
            fallbackReason: error instanceof Error ? error.message : "Google Calendar sync failed",
            ...(await createCalendarInvitePlaceholder(session.id, "ics"))
          });
          continue;
        } catch (fallbackError) {
          results.push({
            sessionId: session.id,
            sessionTitle: session.title,
            status: "failed",
            provider: "ics",
            error: fallbackError instanceof Error ? fallbackError.message : "ICS invite failed"
          });
          continue;
        }
      }

      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        status: "failed",
        provider: mode,
        error: error instanceof Error ? error.message : "Calendar invite failed"
      });
    }
  }

  return {
    cohortId: input.cohortId,
    requestedProvider: mode,
    total: sessions.length,
    created: results.filter((result) => result.status === "created").length,
    failed: results.filter((result) => result.status === "failed").length,
    results
  };
}
