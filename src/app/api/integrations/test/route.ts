import { IntegrationConnectionStatus, IntegrationProvider } from "@prisma/client";
import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { env, getEnvPresence } from "@/lib/env";
import { generateSessionIcs, upsertGoogleCalendarEvent } from "@/modules/calendar";
import { sendWithSendGrid } from "@/modules/email";
import { getDecryptedIntegrationConnection } from "@/services/integrationService";
import { resolveGoogleCalendarSetup } from "@/services/integrationSetupService";

function diagnosticSession() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    id: "mission-control-diagnostic",
    title: "Mission Control diagnostic calendar event",
    description: "This event was created from Settings > Connected Tools to verify calendar readiness.",
    startTime: start,
    endTime: end,
    timezone: "America/New_York",
    location: "Mission Control"
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireRole(MUTATION_ROLES);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "sendgrid") {
      const result = await sendWithSendGrid({
        to: user.email,
        subject: "Mission Control SendGrid diagnostic",
        html: [
          "<p>This is a Mission Control diagnostic email.</p>",
          "<p>If you received this, SendGrid can send from production.</p>"
        ].join(""),
        text: "This is a Mission Control diagnostic email. If you received this, SendGrid can send from production."
      });

      return ok({
        provider: "sendgrid",
        status: "sent",
        recipient: user.email,
        providerMessageId: result.providerMessageId ?? null
      }, { status: 202 });
    }

    if (action === "calendarIcs") {
      const ics = generateSessionIcs(diagnosticSession());

      return ok({
        provider: "ics",
        status: "generated",
        bytes: ics.length,
        summary: "ICS fallback can generate calendar invite files without Google Calendar OAuth."
      });
    }

    if (action === "googleCalendar") {
      const setup = await resolveGoogleCalendarSetup();
      const presence = getEnvPresence();

      if (!presence.googleCalendarConfigured && !(setup.clientId && setup.clientSecret && setup.redirectUri && setup.calendarId)) {
        throw Object.assign(new Error("Google Calendar setup is missing. Save client ID, secret, redirect URI, and calendar ID in Settings > Connected Tools."), {
          code: "BAD_REQUEST",
          status: 400
        });
      }

      const connection = await getDecryptedIntegrationConnection(IntegrationProvider.GOOGLE_CALENDAR);

      if (!connection || connection.status !== IntegrationConnectionStatus.CONNECTED || !connection.accessToken) {
        throw Object.assign(new Error("Google Calendar is configured but not connected. Use Connected Tools > Google Calendar > Connect first."), {
          code: "BAD_REQUEST",
          status: 400
        });
      }

      const result = await upsertGoogleCalendarEvent({
        ...diagnosticSession(),
        accessToken: connection.accessToken,
        calendarId: setup.calendarId || env.GOOGLE_CALENDAR_ID
      });

      return ok({
        provider: "google",
        status: "created",
        eventId: result.id,
        htmlLink: result.htmlLink ?? null
      }, { status: 202 });
    }

    throw Object.assign(new Error("Unsupported integration diagnostic action."), {
      code: "BAD_REQUEST",
      status: 400
    });
  } catch (error) {
    return handleApiError(error);
  }
}
