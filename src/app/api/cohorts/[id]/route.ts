import { fail, handleApiError, ok } from "@/lib/api";
import { getCohortById, updateCohort } from "@/services/cohortService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cohort = await getCohortById(id);

    if (!cohort) {
      return fail("Cohort not found", "NOT_FOUND", 404);
    }

    return ok(cohort);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await updateCohort(id, await request.json()));
  } catch (error) {
    return handleApiError(error);
  }
}
