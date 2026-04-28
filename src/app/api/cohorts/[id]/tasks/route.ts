import { handleApiError, ok } from "@/lib/api";
import { createOperationsTask, listTasksForCohort } from "@/services/operationsTaskService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await listTasksForCohort(id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await createOperationsTask({ ...(await request.json()), cohortId: id }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
