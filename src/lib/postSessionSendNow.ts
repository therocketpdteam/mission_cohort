type Message = { sessionId?: string | null; scheduledFor?: unknown; sentAt?: unknown; status?: string; template?: { type?: string } | null };
// FOLLOW_UP is the session email template type; the similarly named
// POST_SESSION_FOLLOW_UP enum belongs to operational tasks, not email templates.
export const isScheduledPostSession = (message: Message) => Boolean(message.sessionId && message.scheduledFor && message.template?.type === "FOLLOW_UP");
export const canSendPostSessionNow = (message: Message) => isScheduledPostSession(message) && !message.sentAt && ["SCHEDULED", "FAILED"].includes(message.status ?? "");
