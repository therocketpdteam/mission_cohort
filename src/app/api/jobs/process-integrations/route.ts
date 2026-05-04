import { fail, handleApiError, ok } from "@/lib/api";
import { validateJobSecret } from "@/lib/jobAuth";
import { processAllIntegrationWork } from "@/services/integrationJobProcessor";

export async function POST(request: Request) {
  try {
    if (!validateJobSecret(request)) {
      return fail("Invalid job secret", "FORBIDDEN", 403);
    }

    return ok(await processAllIntegrationWork(), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
