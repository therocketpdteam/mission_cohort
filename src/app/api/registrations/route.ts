import { fail, handleApiError, ok } from "@/lib/api";
import {
  bulkUpdateRegistrations,
  cancelRegistration,
  confirmRegistration,
  createRegistration,
  getRegistrationById,
  listRegistrations,
  updateRegistration
} from "@/services/registrationService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");

    if (id) {
      const registration = await getRegistrationById(id);
      return registration ? ok(registration) : fail("Registration not found", "NOT_FOUND", 404);
    }

    return ok(await listRegistrations(params.get("cohortId") ?? undefined));
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

    return ok(await updateRegistration(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
