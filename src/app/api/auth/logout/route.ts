import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/auth";
import { handleApiError, ok } from "@/lib/api";

export async function POST() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(ACCESS_TOKEN_COOKIE);
    cookieStore.delete(REFRESH_TOKEN_COOKIE);
    return ok({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}
