import { handleApiError, ok } from "@/lib/api";
import { processScheduledCommunications } from "@/services/communicationService";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return ok(await processScheduledCommunications(body.limit), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
