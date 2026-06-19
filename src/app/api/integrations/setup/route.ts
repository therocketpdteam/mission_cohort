import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getIntegrationSetups, saveIntegrationSetup } from "@/services/integrationSetupService";
import { listConnectedGoogleCalendars } from "@/services/calendarService";

export async function GET(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const params = new URL(request.url).searchParams;

    if (params.get("provider") === "GOOGLE_CALENDAR" && params.get("action") === "listCalendars") {
      return ok(await listConnectedGoogleCalendars());
    }

    return ok(await getIntegrationSetups());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const body = await request.json();
    return ok(await saveIntegrationSetup(body.provider, body));
  } catch (error) {
    return handleApiError(error);
  }
}
