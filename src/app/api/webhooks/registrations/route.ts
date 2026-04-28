import { fail, handleApiError, ok } from "@/lib/api";
import { processRegistrationWebhook, validateWebhookSecret } from "@/services/webhookService";

export async function POST(request: Request) {
  try {
    if (!validateWebhookSecret(request)) {
      return fail("Invalid webhook secret", "FORBIDDEN", 403);
    }

    const payload = await request.json();
    const result = await processRegistrationWebhook(payload);

    return ok(result, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
