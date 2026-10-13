import { handleApiError, ok } from "@/lib/api";
import { recordJobInvocation, validateJobSecret } from "@/lib/jobAuth";
import { reconcileJotformSubmissions } from "@/services/jotformReconciliationService";

export async function GET(request: Request) {
  try {
    if (!validateJobSecret(request)) {
      throw Object.assign(new Error("Invalid job secret"), { code: "FORBIDDEN", status: 403 });
    }
    await recordJobInvocation(request, "reconcile-jotform-submissions");
    return ok(await reconcileJotformSubmissions(), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
