import { handleApiError, ok } from "@/lib/api";
import { validateJobRequest } from "@/lib/jobAuth";
import { reconcileOpenQuickBooksInvoices } from "@/services/quickBooksService";

async function processRequest(request: Request, limit?: number) {
  try {
    const blockedResponse = validateJobRequest(request);
    if (blockedResponse) return blockedResponse;

    return ok(await reconcileOpenQuickBooksInvoices(limit), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return processRequest(request, Number.isFinite(limit) ? limit : 50);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return processRequest(request, Number(body.limit ?? 50));
}
