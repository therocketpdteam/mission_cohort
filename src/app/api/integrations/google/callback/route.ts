import { handleApiError, ok } from "@/lib/api";
import { completeGoogleCalendarOAuth } from "@/services/calendarService";

export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code");

    if (!code) {
      throw Object.assign(new Error("Google OAuth code is required."), { code: "BAD_REQUEST", status: 400 });
    }

    const connection = await completeGoogleCalendarOAuth(code);
    return ok({
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      accountName: connection.accountName,
      tokenExpiresAt: connection.tokenExpiresAt
    });
  } catch (error) {
    return handleApiError(error);
  }
}
