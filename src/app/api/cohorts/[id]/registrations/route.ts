import { handleApiError, ok } from "@/lib/api";
import { createRegistration, listRegistrations } from "@/services/registrationService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await listRegistrations(id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await createRegistration({ ...(await request.json()), cohortId: id }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
