import { fail, handleApiError, ok } from "@/lib/api";
import { createTemplate, listTemplates, updateTemplate } from "@/services/communicationService";

export async function GET() {
  try {
    return ok(await listTemplates());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createTemplate(await request.json()), { status: 201 });
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

    return ok(await updateTemplate(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
