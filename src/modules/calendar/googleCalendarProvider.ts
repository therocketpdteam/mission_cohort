import { env } from "@/lib/env";

export type GoogleCalendarEventInput = {
  title: string;
  description?: string;
  startTime: Date | string;
  endTime: Date | string;
  timezone: string;
  meetingUrl?: string | null;
  location?: string | null;
};

export async function createGoogleCalendarEventPlaceholder(_input: GoogleCalendarEventInput) {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.GOOGLE_CALENDAR_REDIRECT_URI) {
    throw Object.assign(new Error("Google Calendar is not configured. ICS fallback is available."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return {
    provider: "google",
    status: "pending_oauth_implementation" as const
  };
}
