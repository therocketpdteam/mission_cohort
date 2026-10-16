import { handleApiError, ok } from "@/lib/api";
import { recordJobInvocation, validateJobRequest } from "@/lib/jobAuth";
import { processCrmSyncEvents } from "@/services/crmSyncService";

export const maxDuration = 300;

async function processRequest(request: Request, limit?: number) {
  try {
    const blockedResponse = validateJobRequest(request);
    if (blockedResponse) return blockedResponse;
    await recordJobInvocation(request, "process-crm-sync");

    const missionOnly = new URL(request.url).searchParams.get("missionOnly") === "true";
    return ok(await processCrmSyncEvents(limit, { missionOnly }), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  return processRequest(request, Number.isFinite(limit) ? limit : 25);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return processRequest(request, body.limit);
}
