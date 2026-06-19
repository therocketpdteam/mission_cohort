import { fail, handleApiError, ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { createCalendarInvitePlaceholder, prepareCohortCalendarInvites } from "@/services/calendarService";
import { getIntegrationConnection } from "@/services/integrationService";
import { IntegrationProvider } from "@prisma/client";
import { cancelGoogleCalendarInvites } from "@/services/calendarService";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";

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
      return ok(await cancelGoogleCalendarInvites({ sessionId: body.sessionId }));
    }

    if (body.action === "cancelCohortInvites" && body.cohortId) {
      return ok(await cancelGoogleCalendarInvites({ cohortId: body.cohortId }));
    }

    return fail("A supported cancellation action and target are required.", "BAD_REQUEST", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
