import { fail, handleApiError, ok } from "@/lib/api";
import { validateJobSecret } from "@/lib/jobAuth";
import { processScheduledCommunications } from "@/services/communicationService";

async function processRequest(request: Request, limit?: number) {
  try {
    if (!validateJobSecret(request)) {
      return fail("Invalid job secret", "FORBIDDEN", 403);
    }

    return ok(await processScheduledCommunications(limit), { status: 202 });
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
