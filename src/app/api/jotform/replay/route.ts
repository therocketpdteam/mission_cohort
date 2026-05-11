import { fail, handleApiError, ok } from "@/lib/api";
import { replayJotformWebhookEvent } from "@/services/jotformIntakeService";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(await replayJotformWebhookEvent(body.id), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
