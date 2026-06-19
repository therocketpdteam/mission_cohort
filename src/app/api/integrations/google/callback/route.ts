import { handleApiError } from "@/lib/api";
import { completeGoogleCalendarOAuth } from "@/services/calendarService";

export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code");

    if (!code) {
      throw Object.assign(new Error("Google OAuth code is required."), { code: "BAD_REQUEST", status: 400 });
    }

    await completeGoogleCalendarOAuth(code);
    return Response.redirect(new URL("/settings?googleCalendar=connected", request.url), 302);
  } catch (error) {
    return handleApiError(error);
  }
}
