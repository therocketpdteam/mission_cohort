import { fail, handleApiError, ok } from "@/lib/api";
import { createResource, listResources, updateResource } from "@/services/resourceService";

export async function GET(request: Request) {
  try {
    const cohortId = new URL(request.url).searchParams.get("cohortId") ?? undefined;
    return ok(await listResources(cohortId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createResource(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(await updateResource(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
