import { fail, handleApiError, ok } from "@/lib/api";
import { createRegistrationForm, listFormsByCohort } from "@/services/registrationFormService";

export async function GET(request: Request) {
  try {
    const cohortId = new URL(request.url).searchParams.get("cohortId");

    if (!cohortId) {
      return fail("cohortId query parameter is required", "BAD_REQUEST", 400);
    }

    return ok(await listFormsByCohort(cohortId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createRegistrationForm(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
