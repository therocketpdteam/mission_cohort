import { handleApiError, ok } from "@/lib/api";
import { syncQuickBooksInvoice } from "@/services/quickBooksService";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (!body.invoiceId) {
      throw Object.assign(new Error("invoiceId is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok(await syncQuickBooksInvoice(body.invoiceId, body.realmId), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
