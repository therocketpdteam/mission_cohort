import { handleApiError, ok } from "@/lib/api";
import { getJotformIntakeSetup, listJotformIntakeEvents } from "@/services/jotformIntakeService";

export async function GET() {
  try {
    const [setup, events] = await Promise.all([
      getJotformIntakeSetup(),
      listJotformIntakeEvents()
    ]);

    return ok({ setup, events });
  } catch (error) {
    return handleApiError(error);
  }
}
