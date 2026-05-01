import { handleApiError, ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { listIntegrationJobs, listIntegrationStatuses } from "@/services/integrationService";

export async function GET() {
  try {
    return ok({
      env: getEnvPresence(),
      connections: await listIntegrationStatuses(),
      recentJobs: await listIntegrationJobs()
    });
  } catch (error) {
    return handleApiError(error);
  }
}
