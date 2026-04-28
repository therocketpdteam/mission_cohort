import { handleApiError, ok } from "@/lib/api";
import { recordWebhookEvent } from "@/services/webhookService";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const event = await recordWebhookEvent({
      source: "registration_form",
      eventType: String(payload.eventType ?? "registration.submitted"),
      payload
    });

    return ok(event, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
