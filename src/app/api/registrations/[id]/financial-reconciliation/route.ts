import { ok, handleApiError } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { reviewFinancialRoster } from "@/services/financialRosterReconciliationService";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try { const user=await requireRole(MUTATION_ROLES);const {id}=await params;return ok(await reviewFinancialRoster(id,await request.json(),user.id)); }
  catch(error){return handleApiError(error);}
}
