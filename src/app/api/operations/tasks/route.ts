import { fail, handleApiError, ok } from "@/lib/api";
import {
  completeOperationsTask,
  createOperationsTask,
  listOpenOperationsTasks,
  updateOperationsTask
} from "@/services/operationsTaskService";

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    return ok(await listOpenOperationsTasks(Number.isFinite(limit) ? limit : 20));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createOperationsTask(await request.json()), { status: 201 });
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

    if (body.action === "complete") {
      return ok(await completeOperationsTask(body.id));
    }

    return ok(await updateOperationsTask(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
