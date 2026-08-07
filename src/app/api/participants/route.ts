import { fail, handleApiError, ok } from "@/lib/api";
import { addParticipant, bulkMoveParticipantsToCohort, listParticipantHistorySummaries, listParticipants, removeParticipant, updateParticipant } from "@/services/participantService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("summary") === "1" || params.get("summary") === "true") {
      return ok(await listParticipantHistorySummaries());
    }

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
      if (body.action === "bulkMoveParticipants" && Array.isArray(body.ids)) {
        return ok(await bulkMoveParticipantsToCohort({ ids: body.ids, targetCohortId: body.targetCohortId }));
      }

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
