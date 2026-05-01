import { handleApiError, ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { createCalendarInvitePlaceholder } from "@/services/calendarService";
import { getIntegrationConnection } from "@/services/integrationService";
import { IntegrationProvider } from "@prisma/client";

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
    const body = await request.json().catch(() => ({}));
    return ok(await createCalendarInvitePlaceholder(body.sessionId, body.mode ?? "ics"), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
