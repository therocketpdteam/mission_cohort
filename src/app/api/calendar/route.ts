import { fail, handleApiError, ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { applyCohortCalendarChanges, createCalendarInvitePlaceholder, prepareCohortCalendarInvites } from "@/services/calendarService";
import { getIntegrationConnection } from "@/services/integrationService";
import { IntegrationProvider } from "@prisma/client";
import { cancelGoogleCalendarInvites } from "@/services/calendarService";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { sendCalendarCancellationNotice, sendCohortScheduleChangeNotice } from "@/services/communicationService";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const connection = await getIntegrationConnection(IntegrationProvider.GOOGLE_CALENDAR);
  return ok({
    configured: getEnvPresence().googleCalendarConfigured,
    connection: connection ? {
      id: connection.id,
      provider: connection.provider,
      label: connection.label,
      status: connection.status,
      accountName: connection.accountName,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastSyncedAt: connection.lastSyncedAt,
      errorMessage: connection.errorMessage
    } : null
  });
}

export async function POST(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const body = await request.json().catch(() => ({}));
    if (body.action === "applyCohortChanges" && body.cohortId) {
      const calendar = await applyCohortCalendarChanges(body.cohortId);
      let communication: { status: string; communicationId?: string; error?: string } = { status: "not_needed" };

      if (calendar.applied.length > 0) {
        try {
          const sent = await sendCohortScheduleChangeNotice({ cohortId: body.cohortId, changes: calendar.applied });
          communication = { status: sent ? "sent" : "not_needed", communicationId: sent?.id };
        } catch (error) {
          communication = { status: "failed", error: error instanceof Error ? error.message : "Schedule update email failed" };
        }
      }

      return ok({ ...calendar, communication }, { status: 202 });
    }

    if (body.action === "prepareCohortInvites") {
      return ok(await prepareCohortCalendarInvites({
        cohortId: body.cohortId,
        mode: body.mode ?? "auto",
        fallbackToIcs: body.fallbackToIcs !== false
      }), { status: 202 });
    }

    return ok(await createCalendarInvitePlaceholder(body.sessionId, body.mode ?? "ics"), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const body = await request.json();

    if (body.action === "cancelSessionInvites" && body.sessionId) {
      const calendar = await cancelGoogleCalendarInvites({ sessionId: body.sessionId });
      const session = await prisma.cohortSession.findUnique({ where: { id: body.sessionId }, select: { cohortId: true } });
      let cancellationEmail: { status: string; error?: string } = { status: "not_sent" };
      if (session) {
        try {
          await sendCalendarCancellationNotice({ cohortId: session.cohortId, sessionId: body.sessionId });
          cancellationEmail = { status: "sent" };
        } catch (error) {
          cancellationEmail = { status: "failed", error: error instanceof Error ? error.message : "Cancellation email failed" };
        }
      }
      return ok({ ...calendar, cancellationEmail });
    }

    if (body.action === "cancelCohortInvites" && body.cohortId) {
      const calendar = await cancelGoogleCalendarInvites({ cohortId: body.cohortId });
      let cancellationEmail: { status: string; error?: string };
      try {
        await sendCalendarCancellationNotice({ cohortId: body.cohortId });
        cancellationEmail = { status: "sent" };
      } catch (error) {
        cancellationEmail = { status: "failed", error: error instanceof Error ? error.message : "Cancellation email failed" };
      }
      return ok({ ...calendar, cancellationEmail });
    }

    if (body.action === "sendCohortCancellationNotice" && body.cohortId) {
      const communication = await sendCalendarCancellationNotice({ cohortId: body.cohortId });
      return ok({ status: "sent", communicationId: communication.id });
    }

    return fail("A supported cancellation action and target are required.", "BAD_REQUEST", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
