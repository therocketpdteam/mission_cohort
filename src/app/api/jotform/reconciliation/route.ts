import { handleApiError, ok } from "@/lib/api";
import {
  getJotformReconciliationSetup,
  reconcileJotformSubmissions,
  saveJotformReconciliationApiKey
} from "@/services/jotformReconciliationService";

export async function GET() {
  try {
    return ok(await getJotformReconciliationSetup());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "configure") {
      return ok(await saveJotformReconciliationApiKey(String(body.apiKey ?? "")));
    }
    if (body.action === "run") {
      return ok(await reconcileJotformSubmissions({
        limitPerForm: Number(body.limitPerForm ?? 100),
        lookbackDays: Number(body.lookbackDays ?? 45)
      }), { status: 202 });
    }
    throw Object.assign(new Error("Unsupported reconciliation action."), { code: "BAD_REQUEST", status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
