import { handleApiError, ok } from "@/lib/api";
import { getJotformIntakeSetup, listJotformIntakeEvents } from "@/services/jotformIntakeService";

export async function GET() {
  try {
    const [setupResult, events] = await Promise.all([
      getJotformIntakeSetup()
        .then((setup) => ({ setup, setupError: null }))
        .catch((error) => ({
          setup: {
            configured: false,
            webhookUrl: "",
            lastRotatedAt: null,
            connectionStatus: "ERROR"
          },
          setupError: error instanceof Error ? error.message : "Jotform credential validation failed."
        })),
      listJotformIntakeEvents()
    ]);

    return ok({ ...setupResult, events });
  } catch (error) {
    return handleApiError(error);
  }
}
