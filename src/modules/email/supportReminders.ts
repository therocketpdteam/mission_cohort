import { textToEmailHtml } from "./templateFormatting";
import { renderMergeFields, type MergeFieldContext } from "./mergeFields";

export const supportReminderKinds = ["24h", "60m"] as const;
export type SupportReminderKind = typeof supportReminderKinds[number];
export type SupportPerson = { id: string; name: string; email: string };

export function supportJourneyPrefix(cohortId: string) {
  return `cohort:${cohortId}:support:`;
}

export function supportJourneyKey(cohortId: string, memberId: string, sessionId: string, kind: SupportReminderKind) {
  return `${supportJourneyPrefix(cohortId)}${memberId}:${sessionId}:${kind}`;
}

export function parseSupportJourneyKey(key?: string | null) {
  const match = /^cohort:([^:]+):support:([^:]+):([^:]+):(24h|60m)$/.exec(key ?? "");
  return match ? { cohortId: match[1], memberId: match[2], sessionId: match[3], kind: match[4] as SupportReminderKind } : null;
}

export function isSupportReminder(key?: string | null) {
  return /^cohort:[^:]+:support:/.test(key ?? "");
}

export function supportReminderTime(start: Date, kind: SupportReminderKind) {
  return new Date(start.getTime() - (kind === "24h" ? 24 * 60 : 60) * 60_000);
}

export function supportReminderWindow(start: Date, kind: SupportReminderKind, now: Date) {
  if (now < supportReminderTime(start, kind)) return "early";
  // Never send yesterday's checklist alongside the imminent-session reminder.
  if (now >= (kind === "24h" ? supportReminderTime(start, "60m") : start)) return "expired";
  return "due";
}

export function supportReminderTemplate(kind: SupportReminderKind) {
  const subject = kind === "24h"
    ? "24-hour support reminder: session with {{cohort.presenterName}}"
    : "Support reminder: session with {{cohort.presenterName}} starts soon";
  const intro = kind === "24h"
    ? "This is your 24-hour support reminder for the upcoming Zoom session for {{cohort.title}}. Your preparation helps create a smooth, welcoming experience for the Thought Leader and everyone attending."
    : "This is your 60-minute support reminder for {{cohort.title}}. Thank you for helping make today’s session run smoothly.";
  const bodyText = `Hello {{support.name}},

${intro}

Session: {{session.title}}
Thought Leader: {{cohort.presenterName}}
Starts: {{session.startTime}}
Zoom: {{session.meetingUrl}}
Please join 15–20 minutes before the session starts to complete these checks with the Thought Leader:

- Confirm that you have the Zoom host or co-host permissions needed to support the session.
- Test screen sharing and confirm that slides and other materials display correctly.
- Check microphones, speakers, and the Thought Leader’s audio. Listen for clarity, volume, and echo.
- If videos will be used, play a short sample with Share sound enabled and confirm that attendees will hear it clearly.
- Confirm that cloud recording is available, and remember to start the cloud recording when the session begins.

If the Thought Leader has not joined 5–10 minutes before the scheduled start, message Gerardo or Chris immediately through your usual team channel so we can contact them.

Thank you for taking care of these details and helping everyone have a great session.

The RocketPD Team`;
  return { subject, bodyText, bodyHtml: textToEmailHtml(bodyText) };
}

export function renderSupportReminder(kind: SupportReminderKind, context: MergeFieldContext) {
  const template = supportReminderTemplate(kind);
  const bodyText = renderMergeFields(template.bodyText, context).output;
  // Escape dynamic names and session details as well as the template itself.
  return { subject: renderMergeFields(template.subject, context).output, bodyText, bodyHtml: textToEmailHtml(bodyText) };
}
