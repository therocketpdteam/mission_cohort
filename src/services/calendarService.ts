import { env } from "@/lib/env";

export async function createCalendarInvitePlaceholder() {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID) {
    throw Object.assign(new Error("Google Calendar integration is not configured"), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return { status: "not_implemented" as const };
}
