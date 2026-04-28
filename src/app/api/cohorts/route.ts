import { handleApiError, ok } from "@/lib/api";
import { createCohort, listCohorts } from "@/services/cohortService";

export async function GET() {
  try {
    return ok(await listCohorts());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createCohort(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
