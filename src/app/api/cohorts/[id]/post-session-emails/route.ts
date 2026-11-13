import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { listSessionPostSessionEmails } from "@/services/communicationService";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(ADMIN_ROLES);
    const { id } = await params;
    return ok(await listSessionPostSessionEmails(id));
  } catch (error) { return handleApiError(error); }
}
