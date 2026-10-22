import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { dashboardHealth } from "@/services/dashboardHealthService";

export async function GET() {
  try { await requireRole(ADMIN_ROLES); return ok(await dashboardHealth()); }
  catch (error) { return handleApiError(error); }
}
