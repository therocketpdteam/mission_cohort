import { handleApiError, ok } from "@/lib/api";
import { voidRegistrationQuickBooksInvoice } from "@/services/quickBooksService";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.registrationId) {
      throw Object.assign(new Error("registrationId is required."), { code: "BAD_REQUEST", status: 400 });
    }

    return ok(await voidRegistrationQuickBooksInvoice(body.registrationId), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
