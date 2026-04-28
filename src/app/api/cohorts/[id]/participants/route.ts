import { handleApiError, ok } from "@/lib/api";
import { addParticipant, listParticipantsByCohort } from "@/services/participantService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await listParticipantsByCohort(id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await addParticipant({ ...(await request.json()), cohortId: id }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
