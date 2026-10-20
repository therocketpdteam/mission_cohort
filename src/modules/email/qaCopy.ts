export function productionQaBccEmail(environment: string, configuredEmail?: string | null) {
  if (environment !== "production") return undefined;
  const email = String(configuredEmail ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

// SendGrid returns personalization custom_args as top-level webhook fields.
// A QA recipient's events must not become customer delivery/open statistics.
// Use the metadata saved at send time so delayed events remain recognizable
// after the configured QA address changes or QA copying is disabled.
export function isQaBccEvent(event: Record<string, unknown>) {
  const email = String(event.email ?? "").trim().toLowerCase();
  const qaEmail = String(event.mc_qa_bcc_email ?? "").trim().toLowerCase();
  const intendedEmail = String(event.mc_intended_recipient ?? "").trim().toLowerCase();
  return Boolean(qaEmail && intendedEmail && email === qaEmail && email !== intendedEmail);
}
