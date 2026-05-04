import { fail, handleApiError, ok } from "@/lib/api";
import { validateJobSecret } from "@/lib/jobAuth";
import { syncQuickBooksInvoice } from "@/services/quickBooksService";

export async function POST(request: Request) {
  try {
    if (!validateJobSecret(request)) {
      return fail("Invalid job secret", "FORBIDDEN", 403);
    }

    const body = await request.json().catch(() => ({}));

    if (!body.invoiceId) {
      throw Object.assign(new Error("invoiceId is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok(await syncQuickBooksInvoice(body.invoiceId, body.realmId), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
