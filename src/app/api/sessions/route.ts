import { fail, handleApiError, ok } from "@/lib/api";
import { deleteSession, updateSession } from "@/services/sessionService";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(await updateSession(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");

    if (!id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(await deleteSession(id));
  } catch (error) {
    return handleApiError(error);
  }
}
