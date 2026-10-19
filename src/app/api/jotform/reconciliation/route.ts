import { handleApiError, ok } from "@/lib/api";
import {
  getJotformReconciliationSetup,
  reconcileJotformSubmissions,
  saveJotformReconciliationApiKey
} from "@/services/jotformReconciliationService";
import { processRegistrationWebhook } from "@/services/webhookService";

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
    if (body.action === "recover") {
      const payload = body.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw Object.assign(new Error("A normalized recovery payload is required."), { code: "BAD_REQUEST", status: 400 });
      }

      return ok(await processRegistrationWebhook({
        ...payload,
        source: "jotform",
        eventType: "registration.reconciliation_missing",
        reconciliation: {
          detectedAt: new Date().toISOString(),
          source: "administrative_recovery",
          automaticReplay: false
        }
      }, {
        normalizedInput: true,
        suppressAutomations: true
      }), { status: 202 });
    }
    throw Object.assign(new Error("Unsupported reconciliation action."), { code: "BAD_REQUEST", status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
