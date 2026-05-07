import { USER_MANAGEMENT_ROLES, requireRole, safeUser } from "@/lib/auth";
import { fail, handleApiError, ok } from "@/lib/api";
import { createInternalUser, listInternalUsers, updateInternalUser } from "@/services/userService";

export async function GET() {
  try {
    await requireRole(USER_MANAGEMENT_ROLES);
    const users = await listInternalUsers();
    return ok(users.map(safeUser));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(USER_MANAGEMENT_ROLES);
    return ok(safeUser(await createInternalUser(await request.json())), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(USER_MANAGEMENT_ROLES);
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    return ok(safeUser(await updateInternalUser(body)));
  } catch (error) {
    return handleApiError(error);
  }
}
