// Presentation only: these labels do not change persisted state or eligibility.
export function sessionPhase(session: { startTime?: unknown; endTime?: unknown }, now: number) {
  const start = new Date(String(session.startTime ?? "")).getTime();
  const end = new Date(String(session.endTime ?? "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { label: "Date needs review", tone: "attention" };
  if (now < start) return { label: "Upcoming", tone: "neutral" };
  if (now < end) return { label: "In Progress", tone: "neutral" };
  return { label: "Completed", tone: "success" };
}

export function postSessionPresentation(message: { status: string; providerError?: string | null; scheduledFor: string }, eligible: boolean, ended: boolean, now: number) {
  if (message.status === "SENT") return { label: "Sent", tone: "success", review: false, configuration: false };
  if (message.status === "SENDING") return { label: "Sending", tone: "neutral", review: false, configuration: false };
  const detail = message.providerError ?? "";
  const configuration = /not configured|configure .*first|missing .*credential|api key|outbound (safety|release)|only published|no recipients|cancel.*in progress|attachment .*could not|valid recording/i.test(detail);
  const providerRejection = /SendGrid request failed|SendGrid send failed|provider.*reject|provider.*failed|status (?:4\d\d|5\d\d)/i.test(detail);
  if (message.status === "FAILED") return { label: !configuration && providerRejection ? "Delivery Failed" : "Needs Attention", tone: !configuration && providerRejection ? "failure" : "attention", review: true, configuration };
  if (eligible) return { label: "Ready to Send", tone: "neutral", review: false, configuration: false };
  if (ended) return { label: "Needs Attention", tone: "attention", review: true, configuration: false };
  return { label: "Scheduled", tone: "neutral", review: false, configuration: false };
}
