import { handleApiError, ok } from "@/lib/api";
import { processAllIntegrationWork } from "@/services/integrationJobProcessor";

export async function POST() {
  try {
    return ok(await processAllIntegrationWork(), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
