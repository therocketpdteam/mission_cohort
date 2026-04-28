import { fail, handleApiError, ok } from "@/lib/api";
import {
  createOrganization,
  getOrganizationById,
  listOrganizations,
  updateOrganization
} from "@/services/organizationService";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");

    if (id) {
      const organization = await getOrganizationById(id);
      return organization ? ok(organization) : fail("Organization not found", "NOT_FOUND", 404);
    }

    return ok(await listOrganizations());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createOrganization(await request.json()), { status: 201 });
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

    return ok(await updateOrganization(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
