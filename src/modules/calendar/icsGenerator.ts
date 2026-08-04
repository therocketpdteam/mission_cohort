import { buildSessionCalendarDescription } from "./description";

function formatIcsDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function escapeIcsParam(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
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
  cohort?: {
    title?: string | null;
    description?: string | null;
    presenterName?: string | null;
  } | null;
  attendee?: {
    email?: string | null;
    name?: string | null;
  } | null;
};

export function generateSessionIcs(session: IcsSessionInput) {
  const description = buildSessionCalendarDescription({
    session,
    cohort: session.cohort
  });

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
    "ORGANIZER;CN=The RocketPD Team:mailto:support@rocketpd.com",
    session.attendee?.email
      ? `ATTENDEE;CN="${escapeIcsParam(session.attendee.name || session.attendee.email)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${session.attendee.email.trim().toLowerCase()}`
      : null,
    `X-MICROSOFT-CDO-TZID:${escapeIcs(session.timezone)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}
