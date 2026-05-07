import { currentUser, safeUser } from "@/lib/auth";
import { fail, handleApiError, ok } from "@/lib/api";

export async function GET() {
  try {
    const user = await currentUser();

    if (!user) {
      return fail("Authentication required", "AUTH_REQUIRED", 401);
    }

    return ok(safeUser(user));
  } catch (error) {
    return handleApiError(error);
  }
}
