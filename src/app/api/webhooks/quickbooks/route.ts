import { handleApiError, ok } from "@/lib/api";
import { processQuickBooksWebhook } from "@/services/quickBooksService";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    return ok(await processQuickBooksWebhook(rawBody, request.headers.get("intuit-signature")), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
