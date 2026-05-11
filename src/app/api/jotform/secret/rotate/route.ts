import { handleApiError, ok } from "@/lib/api";
import { rotateJotformWebhookSecret } from "@/services/jotformIntakeService";

export async function POST() {
  try {
    return ok(await rotateJotformWebhookSecret());
  } catch (error) {
    return handleApiError(error);
  }
}
