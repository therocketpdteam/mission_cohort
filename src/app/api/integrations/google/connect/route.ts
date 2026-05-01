import { handleApiError } from "@/lib/api";
import { getGoogleCalendarOAuthUrl } from "@/services/calendarService";

export async function GET() {
  try {
    return Response.redirect(getGoogleCalendarOAuthUrl(), 302);
  } catch (error) {
    return handleApiError(error);
  }
}
