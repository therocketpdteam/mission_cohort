import { fail, handleApiError, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { recordJobInvocation, validateJobRequest } from "@/lib/jobAuth";
import { processCohortStaffCalendarSyncs } from "@/services/cohortStaffCalendarService";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    if (!env.CRON_SECRET) return fail("Job authentication is not configured.", "FORBIDDEN", 403);
    const blocked = validateJobRequest(request);
    if (blocked) return blocked;
    await recordJobInvocation(request, "sync-cohort-staff-invites");
    return ok(await processCohortStaffCalendarSyncs(), { status: 202 });
  } catch (error) { return handleApiError(error); }
}
