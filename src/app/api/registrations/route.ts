import { fail, handleApiError, ok } from "@/lib/api";
import {
  archiveRegistration,
  bulkUpdateRegistrations,
  cancelRegistration,
  confirmRegistration,
  createRegistration,
  deleteRegistration,
  getRegistrationById,
  listRegistrations,
  restoreRegistration,
  updateRegistration
} from "@/services/registrationService";
import { applyRegistrationChanges } from "@/services/registrationChangeService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");

    if (id) {
      const registration = await getRegistrationById(id);
      return registration ? ok(registration) : fail("Registration not found", "NOT_FOUND", 404);
    }

    return ok(await listRegistrations(params.get("cohortId") ?? undefined, { includeArchived: params.get("includeArchived") === "1" }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createRegistration(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      if (body.action === "bulk" && Array.isArray(body.ids)) {
        return ok(await bulkUpdateRegistrations({ ...body, action: body.bulkAction }));
      }

      return fail("id is required", "BAD_REQUEST", 400);
    }

    if (body.action === "confirm") {
      return ok(await confirmRegistration(body.id));
    }

    if (body.action === "cancel") {
      return ok(await cancelRegistration(body.id));
    }

    if (body.action === "archive") {
      return ok(await archiveRegistration(body.id, body.reason));
    }

    if (body.action === "restore") {
      return ok(await restoreRegistration(body.id));
    }

    if (body.action === "applyChanges") {
      return ok(await applyRegistrationChanges(body.id));
    }

    return ok(await updateRegistration(body.id, body, { deferNotifications: true }));
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

    return ok(await deleteRegistration(id));
  } catch (error) {
    return handleApiError(error);
  }
}
