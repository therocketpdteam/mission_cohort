import { fail, handleApiError, ok } from "@/lib/api";
import {
  createPaymentRecord,
  getPendingPayments,
  listPayments,
  updatePaymentRecord,
  updatePaymentStatus
} from "@/services/paymentService";

export async function GET(request: Request) {
  try {
    const pending = new URL(request.url).searchParams.get("pending");
    return ok(pending === "true" ? await getPendingPayments() : await listPayments());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createPaymentRecord(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    if (body.status) {
      return ok(await updatePaymentStatus(body.id, body));
    }

    return ok(await updatePaymentRecord(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
