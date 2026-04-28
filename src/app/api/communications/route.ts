import { fail, handleApiError, ok } from "@/lib/api";
import {
  createCommunicationDraft,
  listCommunicationsByCohort,
  scheduleCommunicationPlaceholder
} from "@/services/communicationService";

export async function GET(request: Request) {
  try {
    const cohortId = new URL(request.url).searchParams.get("cohortId");

    if (!cohortId) {
      return fail("cohortId query parameter is required", "BAD_REQUEST", 400);
    }

    return ok(await listCommunicationsByCohort(cohortId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createCommunicationDraft(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "schedule") {
      return ok(await scheduleCommunicationPlaceholder(body));
    }

    return fail("Unsupported communication action", "BAD_REQUEST", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
