import { fail, handleApiError, ok } from "@/lib/api";
import { validateJobSecret } from "@/lib/jobAuth";
import { processScheduledCommunications } from "@/services/communicationService";

export async function POST(request: Request) {
  try {
    if (!validateJobSecret(request)) {
      return fail("Invalid job secret", "FORBIDDEN", 403);
    }

    const body = await request.json().catch(() => ({}));
    return ok(await processScheduledCommunications(body.limit), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
