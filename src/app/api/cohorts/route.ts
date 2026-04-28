import { handleApiError, ok } from "@/lib/api";
import { createCohort, createCohortWithSessions, listCohorts } from "@/services/cohortService";

export async function GET() {
  try {
    return ok(await listCohorts());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const cohort = Array.isArray(body.sessions) ? await createCohortWithSessions(body) : await createCohort(body);
    return ok(cohort, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
