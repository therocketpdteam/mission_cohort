type Message = { sessionId?: string | null; scheduledFor?: unknown; sentAt?: unknown; status?: string; template?: { type?: string } | null };
export const isScheduledPostSession = (message: Message) => Boolean(message.sessionId && message.scheduledFor && message.template?.type === "FOLLOW_UP");
export const canSendPostSessionNow = (message: Message) => isScheduledPostSession(message) && !message.sentAt && ["SCHEDULED", "FAILED"].includes(message.status ?? "");

export function validRecordingLink(value: unknown) {
  try { const url = new URL(String(value ?? "")); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}

export function postSessionWindow(message: Message, session: { endTime?: unknown; recordingUrl?: unknown }, now = Date.now()) {
  const end = new Date(String(session.endTime ?? "")).getTime();
  const scheduled = new Date(String(message.scheduledFor ?? "")).getTime();
  if (!canSendPostSessionNow(message)) return { eligible: false, reason: "This email is no longer awaiting delivery." };
  if (!Number.isFinite(end) || !Number.isFinite(scheduled)) return { eligible: false, reason: "The session end or email schedule is unavailable." };
  if (now < end) return { eligible: false, reason: "Available after the session ends." };
  if (now >= scheduled) return { eligible: false, reason: "The scheduled delivery time has arrived. Review delivery status instead of sending early." };
  if (!validRecordingLink(session.recordingUrl)) return { eligible: false, reason: "Add a valid recording link to this session before sending its post-session email." };
  return { eligible: true, reason: null };
}
