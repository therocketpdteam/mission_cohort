import { fail, handleApiError, ok } from "@/lib/api";
import { getRecipientCommunicationThread } from "@/services/communicationService";

export async function GET(request: Request) {
  try {
    const email = new URL(request.url).searchParams.get("email");

    if (!email) {
      return fail("email query parameter is required", "BAD_REQUEST", 400);
    }

    return ok(await getRecipientCommunicationThread(email));
  } catch (error) {
    return handleApiError(error);
  }
}
