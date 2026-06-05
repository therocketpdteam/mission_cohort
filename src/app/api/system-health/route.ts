import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { buildSystemHealth } from "@/lib/systemHealth";

export async function GET() {
  try {
    await requireRole(ADMIN_ROLES);
    return ok(await buildSystemHealth());
  } catch (error) {
    return handleApiError(error);
  }
}
