import { handleApiError, ok } from "@/lib/api";
import { searchPeople } from "@/services/peopleSearchService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;

    return ok(await searchPeople({
      query: params.get("q"),
      limit: Number(params.get("limit") ?? 12)
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
