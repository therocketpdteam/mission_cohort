function formatIcsDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

export type IcsSessionInput = {
  id?: string;
  title: string;
  description?: string | null;
  startTime: Date | string;
  endTime: Date | string;
  timezone: string;
  meetingUrl?: string | null;
  location?: string | null;
};

export function generateSessionIcs(session: IcsSessionInput) {
  const description = [session.description, session.meetingUrl ? `Meeting URL: ${session.meetingUrl}` : null]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RocketPD//Mission Control//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${session.id ?? crypto.randomUUID()}@mission-control.rocketpd`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(session.startTime)}`,
    `DTEND:${formatIcsDate(session.endTime)}`,
    `SUMMARY:${escapeIcs(session.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(session.location ?? session.meetingUrl ?? "")}`,
    `X-MICROSOFT-CDO-TZID:${escapeIcs(session.timezone)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}
