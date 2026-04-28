import { handleApiError, ok } from "@/lib/api";
import { createSession, listSessionsByCohort } from "@/services/sessionService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await listSessionsByCohort(id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await createSession({ ...(await request.json()), cohortId: id }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
