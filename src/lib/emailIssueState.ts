type EmailIssueEvent = {
  eventType?: string | null;
  recipientEmail?: string | null;
  createdAt?: Date | string | null;
  reviewedAt?: Date | string | null;
};

const issueTypes = new Set(["FAILED", "BOUNCED"]);
const recoveryTypes = new Set(["SENT", "DELIVERED", "OPENED", "CLICKED"]);

function timestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function normalizedEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isActiveEmailIssue(event: EmailIssueEvent, events: EmailIssueEvent[]) {
  const eventType = String(event.eventType ?? "").toUpperCase();
  if (!issueTypes.has(eventType) || event.reviewedAt) return false;

  const recipientEmail = normalizedEmail(event.recipientEmail);
  const issueTime = timestamp(event.createdAt);
  return !events.some((candidate) => {
    const candidateType = String(candidate.eventType ?? "").toUpperCase();
    return recoveryTypes.has(candidateType)
      && normalizedEmail(candidate.recipientEmail) === recipientEmail
      && timestamp(candidate.createdAt) > issueTime;
  });
}

export function activeEmailIssues(events: EmailIssueEvent[]) {
  return events.filter((event) => isActiveEmailIssue(event, events));
}
