import { handleApiError, ok } from "@/lib/api";
import { recordSendGridEvents } from "@/services/communicationService";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const events = Array.isArray(payload) ? payload : [payload];
    return ok(await recordSendGridEvents(events), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
