import { fail, handleApiError, ok } from "@/lib/api";
import {
  createJotformFormMapping,
  listJotformFormMappings,
  updateJotformFormMapping
} from "@/services/jotformMappingService";

export async function GET() {
  try {
    return ok(await listJotformFormMappings());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createJotformFormMapping(await request.json()), { status: 201 });
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

    return ok(await updateJotformFormMapping(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
