import { handleApiError, ok } from "@/lib/api";
import { ADMIN_ROLES, MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getCohortSupportTeam, saveCohortSupportTeam } from "@/services/cohortSupportService";
import { getCohortStaffCalendarState, syncCohortStaffCalendar } from "@/services/cohortStaffCalendarService";

export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(ADMIN_ROLES);
    const { id } = await params;
    return ok({ ...await getCohortSupportTeam(id), calendar: await getCohortStaffCalendarState(id) });
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(MUTATION_ROLES);
    const { id } = await params;
    const team = await saveCohortSupportTeam(id, await request.json(), user.id);
    const calendar = await syncCohortStaffCalendar(id).catch((error) => ({ status: "failed", error: error instanceof Error ? error.message : "Calendar sync is pending. Retry Sync calendar invitations." }));
    return ok({ ...team, calendar });
  } catch (error) { return handleApiError(error); }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(MUTATION_ROLES);
    return ok(await syncCohortStaffCalendar((await params).id));
  } catch (error) { return handleApiError(error); }
}
