import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getCohortSupportTeam, saveCohortSupportTeam } from "@/services/cohortSupportService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(ADMIN_ROLES);
    return ok(await getCohortSupportTeam((await params).id));
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(MUTATION_ROLES);
    return ok(await saveCohortSupportTeam((await params).id, await request.json(), user.id));
  } catch (error) { return handleApiError(error); }
}
