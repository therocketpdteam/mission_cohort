import { fail, handleApiError, ok } from "@/lib/api";
import { getCohortById, publishCohort, updateCohort } from "@/services/cohortService";
import { ensureCohortQuickBooksProject } from "@/services/quickBooksService";

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
    const body = await request.json();
    if (body.action === "publish") {
      return ok(await publishCohort(id));
    }

    if (body.action === "syncQuickBooksProject") {
      return ok(await ensureCohortQuickBooksProject(id));
    }

    return ok(await updateCohort(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
