import { handleApiError, ok } from "@/lib/api";
import { getSendGridSetup } from "@/services/integrationSetupService";
import { recordSendGridEvents } from "@/services/communicationService";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const events = Array.isArray(payload) ? payload : [payload];
    const setup = await getSendGridSetup();

    if (!setup.webhookIngestionEnabled) {
      return ok({
        processed: 0,
        skipped: events.length,
        paused: true,
        message: "SendGrid webhook telemetry is paused. Email sending is not affected."
      }, { status: 202 });
    }

    return ok(await recordSendGridEvents(events), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
