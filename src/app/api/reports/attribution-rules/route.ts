import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getAttributionRules, saveAttributionRules } from "@/services/attributionRuleService";
export async function GET() {
  try { await requireRole(ADMIN_ROLES); return ok(await getAttributionRules()); } catch (error) { return handleApiError(error); }
}
export async function PATCH(request: Request) {
  try { const user = await requireRole(MUTATION_ROLES); return ok(await saveAttributionRules(await request.json(), user.id)); } catch (error) { return handleApiError(error); }
}
