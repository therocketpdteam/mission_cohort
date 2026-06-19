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
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  sendUpdates?: boolean;
};

export type GoogleCalendarOAuthConfig = {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  calendarId?: string | null;
};

const googleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
];

function googleConfig(config?: GoogleCalendarOAuthConfig) {
  return {
    clientId: config?.clientId ?? env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: config?.clientSecret ?? env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: config?.redirectUri ?? env.GOOGLE_CALENDAR_REDIRECT_URI,
    calendarId: config?.calendarId ?? env.GOOGLE_CALENDAR_ID
  };
}

export function getGoogleCalendarConnectUrl(state = "mission-control", config?: GoogleCalendarOAuthConfig) {
  const resolved = googleConfig(config);

  if (!resolved.clientId || !resolved.redirectUri) {
    throw Object.assign(new Error("Google Calendar OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", resolved.clientId);
  url.searchParams.set("redirect_uri", resolved.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", googleCalendarScopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCalendarCode(code: string, config?: GoogleCalendarOAuthConfig) {
  const resolved = googleConfig(config);

  if (!resolved.clientId || !resolved.clientSecret || !resolved.redirectUri) {
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
      client_id: resolved.clientId,
      client_secret: resolved.clientSecret,
      redirect_uri: resolved.redirectUri,
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

export async function refreshGoogleCalendarToken(refreshToken: string, config?: GoogleCalendarOAuthConfig) {
  const resolved = googleConfig(config);

  if (!resolved.clientId || !resolved.clientSecret) {
    throw Object.assign(new Error("Google Calendar OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: resolved.clientId,
      client_secret: resolved.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Calendar token refresh failed with status ${response.status}. Reconnect Google Calendar in Settings.`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<{
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
}

export async function upsertGoogleCalendarEvent(input: GoogleCalendarEventInput) {
  const calendarIdValue = input.calendarId ?? env.GOOGLE_CALENDAR_ID;

  if (!input.accessToken || !calendarIdValue) {
    throw Object.assign(new Error("Google Calendar is not connected. ICS fallback is available."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const calendarId = encodeURIComponent(calendarIdValue);
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
    },
    attendees: input.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName || undefined,
      responseStatus: "needsAction"
    }))
  };
  const eventUrl = input.providerEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(input.providerEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const url = new URL(eventUrl);

  if (input.sendUpdates && input.attendees?.length) {
    url.searchParams.set("sendUpdates", "all");
  }

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

export async function listGoogleCalendars(input: { accessToken?: string }) {
  if (!input.accessToken) {
    throw Object.assign(new Error("Google Calendar is not connected."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Calendar list request failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const payload = await response.json() as {
    items?: Array<{
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
      backgroundColor?: string;
    }>;
  };

  return (payload.items ?? []).map((calendar) => ({
    id: calendar.id ?? "",
    summary: calendar.summary ?? calendar.id ?? "Calendar",
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole ?? "",
    backgroundColor: calendar.backgroundColor ?? ""
  })).filter((calendar) => calendar.id);
}
