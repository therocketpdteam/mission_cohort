export function normalizedRecipient(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function emailSearchRecipient(value: unknown) {
  const email = normalizedRecipient(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export type HistoricalContent = {
  provenance: "snapshot" | "reconstructed" | "unavailable";
  subject: string;
  bodyHtml: string;
  bodyText: string;
  warnings: string[];
  attachments: Array<{ fileName?: string; contentType?: string | null }>;
};

export function uniqueHistoryEvents<T extends { id?: string }>(events: T[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event.id) return true;
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export function sentHistoryAttempts(events: Array<Record<string, any>>, recipient: string) {
  const email = normalizedRecipient(recipient);
  const byMessage = new Map<string, Record<string, any>>();
  for (const event of uniqueHistoryEvents(events)) {
    if (event.eventType !== "SENT" || normalizedRecipient(event.recipientEmail) !== email) continue;
    const payload = event.eventPayload ?? {};
    const hasSnapshot = typeof payload.renderedBodyHtml === "string" || typeof payload.renderedBodyText === "string";
    // SendGrid appends a recipient-specific suffix to its message ID in webhooks.
    const providerId = String(event.providerMessageId ?? "").split(".")[0];
    const key = providerId || String(event.id ?? event.createdAt);
    const previous = byMessage.get(key);
    if (!previous || (hasSnapshot && !previous.content)) {
      byMessage.set(key, {
        id: String(event.id ?? key), sentAt: event.createdAt, savedSubject: typeof payload.renderedSubject === "string" ? payload.renderedSubject : undefined,
        content: hasSnapshot ? {
          provenance: "snapshot", subject: String(payload.renderedSubject ?? ""),
          bodyHtml: String(payload.renderedBodyHtml ?? ""), bodyText: String(payload.renderedBodyText ?? ""),
          warnings: [], attachments: Array.isArray(payload.attachments) ? payload.attachments : []
        } satisfies HistoricalContent : null
      });
    }
  }
  return [...byMessage.values()].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

export function historyTiming(row: Record<string, any>) {
  if (row.sentAt || row.status === "SENT") return { label: row.status === "SENT" ? "Sent" : "Last send", at: row.sentAt ?? null, scheduledFor: row.scheduledFor || null };
  if (row.status === "SCHEDULED" || row.status === "SENDING") return { label: row.status === "SENDING" ? "Sending" : "Scheduled", at: row.scheduledFor, scheduledFor: null };
  return { label: row.status === "DRAFT" ? "Draft created" : "Updated", at: row.updatedAt ?? row.createdAt, scheduledFor: null };
}

export function isolatedEmailDocument(html: string) {
  // CSP also covers tracking pixels, CSS URLs, frames, forms, and navigation.
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; script-src 'none'";
  const safeHtml = html.replace(/<meta\b[^>]*>|<base\b[^>]*>/gi, "");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>body{font:15px/1.6 Arial,sans-serif;color:#243247;margin:20px;overflow-wrap:anywhere}a{pointer-events:none}img{max-width:100%}</style></head><body>${safeHtml}</body></html>`;
}
