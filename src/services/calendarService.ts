import { CalendarInviteStatus, IntegrationConnectionStatus, IntegrationProvider, OperationsTaskCategory, OperationsTaskStatus, ParticipantStatus, RegistrationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteGoogleCalendarEvent, exchangeGoogleCalendarCode, generateSessionIcs, getGoogleCalendarConnectUrl, getGoogleCalendarEvent, listGoogleCalendars, refreshGoogleCalendarToken, uniqueCalendarAttendees, upsertGoogleCalendarEvent } from "@/modules/calendar";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";
import { assertOutboundRecipientsAllowed, resolveGoogleCalendarSetup } from "@/services/integrationSetupService";

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

export async function getConnectedGoogleCalendarAccessToken() {
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.GOOGLE_CALENDAR);

  if (!connection?.accessToken || connection.status !== IntegrationConnectionStatus.CONNECTED) {
    throw Object.assign(new Error("Google Calendar is not connected. Connect it in Settings > Connected Tools."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const expiresSoon = !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() <= Date.now() + 5 * 60 * 1000;

  if (!expiresSoon) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    throw Object.assign(new Error("Google Calendar access expired. Reconnect it in Settings > Connected Tools."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const token = await refreshGoogleCalendarToken(connection.refreshToken, await googleSetupWithEnvFallback());
  await upsertIntegrationConnection({
    provider: IntegrationProvider.GOOGLE_CALENDAR,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: connection.accountName ?? "Google Calendar",
    accessToken: token.access_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    errorMessage: null
  });

  return token.access_token;
}

async function getCohortCalendarAttendees(cohortId: string) {
  const registrations = await prisma.registration.findMany({
    where: {
      cohortId,
      archivedAt: null,
      status: { not: RegistrationStatus.CANCELLED }
    },
    select: {
      primaryContactEmail: true,
      primaryContactName: true,
      participantCount: true,
      participants: {
        where: { status: ParticipantStatus.REGISTERED },
        select: { email: true, firstName: true, lastName: true }
      }
    }
  });
  const rows = registrations.flatMap((registration) => {
    if (registration.participants.length > 0) {
      return registration.participants.map((participant) => ({
        email: participant.email,
        displayName: [participant.firstName, participant.lastName].filter(Boolean).join(" ")
      }));
    }

    return registration.participantCount <= 1
      ? [{ email: registration.primaryContactEmail, displayName: registration.primaryContactName }]
      : [];
  });

  return uniqueCalendarAttendees(rows);
}

export async function listConnectedGoogleCalendars() {
  return listGoogleCalendars({ accessToken: await getConnectedGoogleCalendarAccessToken() });
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
      const attendees = await getCohortCalendarAttendees(session.cohortId);
      await assertOutboundRecipientsAllowed("GOOGLE_CALENDAR", attendees.map((attendee) => attendee.email));
      const existing = await prisma.calendarEvent.findFirst({
        where: { sessionId: session.id, provider: "google" },
        orderBy: { createdAt: "desc" }
      });
      const existingGoogleEvent = existing?.providerEventId
        ? await getGoogleCalendarEvent({
            accessToken: await getConnectedGoogleCalendarAccessToken(),
            calendarId: (await googleSetupWithEnvFallback()).calendarId,
            providerEventId: existing.providerEventId
          })
        : null;
      const existingResponses = new Map(
        (existingGoogleEvent?.attendees ?? [])
          .filter((attendee) => attendee.email)
          .map((attendee) => [attendee.email!.toLowerCase(), attendee.responseStatus])
      );
      const result = await upsertGoogleCalendarEvent({
        title: session.title,
        description: session.description ?? undefined,
        startTime: session.startTime,
        endTime: session.endTime,
        timezone: session.timezone,
        meetingUrl: session.meetingUrl,
        location: session.location,
        accessToken: await getConnectedGoogleCalendarAccessToken(),
        calendarId: (await googleSetupWithEnvFallback()).calendarId,
        providerEventId: existingGoogleEvent ? existing?.providerEventId : null,
        attendees: attendees.map((attendee) => ({
          ...attendee,
          responseStatus: existingResponses.get(attendee.email.toLowerCase())
        })),
        sendUpdates: true
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

      return { provider: "google", status: "created", attendeeCount: attendees.length, event: calendarEvent };
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

async function connectedGoogleEventDetails(sessionIds: string[]) {
  const [calendarEvents, accessToken, setup] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { sessionId: { in: sessionIds }, provider: "google", providerEventId: { not: null } },
      orderBy: { createdAt: "desc" }
    }),
    getConnectedGoogleCalendarAccessToken(),
    googleSetupWithEnvFallback()
  ]);
  const latestBySession = new Map<string, (typeof calendarEvents)[number]>();

  for (const event of calendarEvents) {
    if (!latestBySession.has(event.sessionId)) {
      latestBySession.set(event.sessionId, event);
    }
  }

  const details = await Promise.all([...latestBySession.values()].map(async (event) => ({
    record: event,
    googleEvent: await getGoogleCalendarEvent({
      accessToken,
      calendarId: setup.calendarId,
      providerEventId: event.providerEventId!
    })
  })));

  return { details, accessToken, calendarId: setup.calendarId };
}

export async function cancelGoogleCalendarInvites(input: { sessionId?: string; cohortId?: string }) {
  const sessions = await prisma.cohortSession.findMany({
    where: input.sessionId ? { id: input.sessionId } : input.cohortId ? { cohortId: input.cohortId } : { id: "" },
    select: { id: true }
  });

  if (sessions.length === 0) {
    throw Object.assign(new Error("No matching sessions were found."), { code: "NOT_FOUND", status: 404 });
  }

  const sessionIds = sessions.map((session) => session.id);
  const { details, accessToken, calendarId } = await connectedGoogleEventDetails(sessionIds);
  const recipientEmails = details.flatMap(({ googleEvent }) => (googleEvent?.attendees ?? []).map((attendee) => attendee.email ?? ""));
  await assertOutboundRecipientsAllowed("GOOGLE_CALENDAR", recipientEmails);

  for (const { record, googleEvent } of details) {
    if (googleEvent) {
      await deleteGoogleCalendarEvent({
        accessToken,
        calendarId,
        providerEventId: record.providerEventId!,
        sendUpdates: true
      });
    }
  }

  await prisma.$transaction([
    prisma.calendarEvent.deleteMany({ where: { sessionId: { in: sessionIds }, provider: "google" } }),
    prisma.calendarEvent.deleteMany({ where: { sessionId: { in: sessionIds }, provider: "ics" } }),
    prisma.cohortSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { calendarInviteStatus: CalendarInviteStatus.NOT_CREATED }
    }),
    prisma.operationsTask.updateMany({
      where: { sessionId: { in: sessionIds }, category: OperationsTaskCategory.CALENDAR_INVITE },
      data: { status: OperationsTaskStatus.OPEN, completedAt: null }
    })
  ]);

  return {
    sessionsMatched: sessionIds.length,
    googleEventsCancelled: details.filter(({ googleEvent }) => Boolean(googleEvent)).length,
    recipientsNotified: new Set(recipientEmails.filter(Boolean).map((email) => email.toLowerCase())).size
  };
}

export async function prepareCohortCalendarInvites(input: { cohortId?: string; mode?: "google" | "ics" | "auto"; fallbackToIcs?: boolean }) {
  if (!input.cohortId) {
    throw Object.assign(new Error("cohortId is required"), { code: "BAD_REQUEST", status: 400 });
  }

  const sessions = await prisma.cohortSession.findMany({
    where: { cohortId: input.cohortId },
    orderBy: { startTime: "asc" }
  });
  const googleConnection = await getDecryptedIntegrationConnection(IntegrationProvider.GOOGLE_CALENDAR);
  const mode = input.mode === "auto" || !input.mode
    ? googleConnection?.status === IntegrationConnectionStatus.CONNECTED ? "google" : "ics"
    : input.mode;
  const recipientCount = mode === "google" ? (await getCohortCalendarAttendees(input.cohortId)).length : 0;
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
    recipientCount,
    invitationCount: results.reduce((count, result) => count + Number("attendeeCount" in result ? result.attendeeCount ?? 0 : 0), 0),
    results
  };
}
