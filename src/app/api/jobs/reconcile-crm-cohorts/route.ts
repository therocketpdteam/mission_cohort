import { fail, handleApiError, ok } from "@/lib/api";
import { validateJobSecret } from "@/lib/jobAuth";
import { reconcileActiveCohortsToCrm } from "@/services/crmReconciliationService";

function readPositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function processRequest(request: Request, body?: unknown) {
  try {
    if (!validateJobSecret(request)) {
      return fail("Invalid job secret", "FORBIDDEN", 403);
    }

    const searchParams = new URL(request.url).searchParams;
    const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const limitFromBody = typeof bodyRecord.limit === "number" ? bodyRecord.limit : undefined;
    const recentlyCompletedDaysFromBody =
      typeof bodyRecord.recentlyCompletedDays === "number" ? bodyRecord.recentlyCompletedDays : undefined;

    return ok(
      await reconcileActiveCohortsToCrm({
        limit: limitFromBody ?? readPositiveInt(searchParams.get("limit"), 10),
        recentlyCompletedDays:
          recentlyCompletedDaysFromBody ?? readPositiveInt(searchParams.get("recentlyCompletedDays"), 30)
      }),
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return processRequest(request, body);
}
