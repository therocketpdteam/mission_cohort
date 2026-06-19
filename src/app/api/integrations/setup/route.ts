import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getIntegrationSetups, saveIntegrationSetup } from "@/services/integrationSetupService";

export async function GET() {
  try {
    await requireRole(MUTATION_ROLES);
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
