import { fail, handleApiError, ok } from "@/lib/api";
import { createPresenter, getPresenterById, listPresenters, updatePresenter } from "@/services/presenterService";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");

    if (id) {
      const presenter = await getPresenterById(id);
      return presenter ? ok(presenter) : fail("Presenter not found", "NOT_FOUND", 404);
    }

    return ok(await listPresenters());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createPresenter(await request.json()), { status: 201 });
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

    return ok(await updatePresenter(body.id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
