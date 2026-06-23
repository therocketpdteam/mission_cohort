import { fail, handleApiError, ok } from "@/lib/api";
import { addParticipant, listParticipants, removeParticipant, updateParticipant } from "@/services/participantService";

export async function GET() {
  try {
    return ok(await listParticipants());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return ok(await addParticipant(body, { deferNotifications: true }), { status: 201 });
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

    return ok(await updateParticipant(body.id, body, { deferNotifications: true }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");

    if (!id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(await removeParticipant(id, { deferNotifications: true }));
  } catch (error) {
    return handleApiError(error);
  }
}
