import { handleApiError, ok } from "@/lib/api";
import { listCrmSyncEvents, processCrmSyncEvents } from "@/services/crmSyncService";

export async function GET() {
  try {
    return ok(await listCrmSyncEvents());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return ok(await processCrmSyncEvents(body.limit), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
