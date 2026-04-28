import { handleApiError, ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { createCalendarInvitePlaceholder } from "@/services/calendarService";

export async function GET() {
  return ok({
    configured: getEnvPresence().googleCalendarConfigured,
    status: "pending_integration"
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
