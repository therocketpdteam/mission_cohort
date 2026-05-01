import { env } from "@/lib/env";

export type GoogleCalendarEventInput = {
  title: string;
  description?: string;
  startTime: Date | string;
  endTime: Date | string;
  timezone: string;
  meetingUrl?: string | null;
  location?: string | null;
  accessToken?: string;
  calendarId?: string;
  providerEventId?: string | null;
};

const googleCalendarScopes = ["https://www.googleapis.com/auth/calendar.events"];

export function getGoogleCalendarConnectUrl(state = "mission-control") {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_REDIRECT_URI) {
    throw Object.assign(new Error("Google Calendar OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_CALENDAR_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", googleCalendarScopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCalendarCode(code: string) {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.GOOGLE_CALENDAR_REDIRECT_URI) {
    throw Object.assign(new Error("Google Calendar OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALENDAR_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Calendar token exchange failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
}

export async function upsertGoogleCalendarEvent(input: GoogleCalendarEventInput) {
  if (!input.accessToken || !env.GOOGLE_CALENDAR_ID) {
    throw Object.assign(new Error("Google Calendar is not connected. ICS fallback is available."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const calendarId = encodeURIComponent(input.calendarId ?? env.GOOGLE_CALENDAR_ID);
  const body = {
    summary: input.title,
    description: [input.description, input.meetingUrl ? `Meeting URL: ${input.meetingUrl}` : ""].filter(Boolean).join("\n\n"),
    location: input.location ?? input.meetingUrl ?? undefined,
    start: {
      dateTime: new Date(input.startTime).toISOString(),
      timeZone: input.timezone
    },
    end: {
      dateTime: new Date(input.endTime).toISOString(),
      timeZone: input.timezone
    }
  };
  const url = input.providerEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(input.providerEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const response = await fetch(url, {
    method: input.providerEventId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Calendar event request failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<{ id: string; htmlLink?: string }>;
}
