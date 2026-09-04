"use client";

import { Button, Typography } from "@/components/ui/primitives";
import { formatStatusLabel } from "@/lib/formatting";
import { AdminRow, DateBadge, EmptyState, StatusChip } from "./common";

function communicationIssueLabel(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  if (Number(summary.unreviewedIssueCount ?? 0) > 0) return "Open issue";
  if (Number(summary.reviewedIssueCount ?? 0) > 0) return "Reviewed issue";
  return null;
}

function deliveryAttemptCount(communication: AdminRow) {
  return Number(communication.emailSummary?.sentCount ?? (communication.sentAt ? 1 : 0));
}

function isSentCommunication(communication: AdminRow) {
  return String(communication.status ?? "").toUpperCase() === "SENT" || Boolean(communication.sentAt);
}

function summaryChips(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  const attachments = Number(communication.attachments?.length ?? 0);
  const chips = [
    deliveryAttemptCount(communication) > 0 ? `${deliveryAttemptCount(communication)} delivery attempt${deliveryAttemptCount(communication) === 1 ? "" : "s"}` : "",
    Number(summary.deliveredCount ?? 0) > 0 ? `${summary.deliveredCount} delivered` : "",
    Number(summary.openedCount ?? 0) > 0 ? `${summary.openedCount} opened` : "",
    Number(summary.clickedCount ?? 0) > 0 ? `${summary.clickedCount} clicked` : "",
    attachments > 0 ? `${attachments} attachment${attachments === 1 ? "" : "s"}` : "",
    communicationIssueLabel(communication) ?? ""
  ].filter(Boolean);

  return chips.length ? chips : [communication.status ? formatStatusLabel(communication.status) : "Recorded"];
}

function lastActivity(communication: AdminRow) {
  return communication.emailSummary?.lastEmailEventAt ?? communication.sentAt ?? communication.createdAt ?? null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function payloadFor(communication: AdminRow) {
  const event = ((communication.emailEvents ?? []) as AdminRow[]).find((row) => {
    const payload = row.eventPayload as AdminRow | undefined;
    return payload?.renderedBodyText || payload?.renderedBodyHtml || payload?.renderedSubject;
  });
  return (event?.eventPayload ?? null) as AdminRow | null;
}

function plainBody(communication: AdminRow) {
  const payload = payloadFor(communication);
  const text = String(payload?.renderedBodyText ?? communication.bodyText ?? "").trim();
  if (text) return text;

  return String(payload?.renderedBodyHtml ?? communication.bodyHtml ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function recipientsFor(communication: AdminRow, pocEmail?: string | null) {
  return uniqueStrings([
    ...(((communication.emailEvents ?? []) as AdminRow[]).map((event) => event.recipientEmail as string | undefined)),
    ...(Array.isArray(communication.recipientEmails) ? communication.recipientEmails as string[] : []),
    pocEmail
  ]);
}

function summarizeHistory(communications: AdminRow[], pocEmail?: string | null) {
  const uniqueContacts = uniqueStrings(communications.flatMap((communication) => recipientsFor(communication, pocEmail).map((email) => email.toLowerCase()))).length;

  return communications.reduce((summary, communication) => {
    const emailSummary = communication.emailSummary ?? {};
    return {
      emailRecords: summary.emailRecords + 1,
      sentRecords: summary.sentRecords + (isSentCommunication(communication) ? 1 : 0),
      deliveryAttempts: summary.deliveryAttempts + deliveryAttemptCount(communication),
      opened: summary.opened + Number(emailSummary.openedCount ?? 0),
      issues: summary.issues + Number(emailSummary.unreviewedIssueCount ?? 0),
      uniqueContacts
    };
  }, { emailRecords: 0, sentRecords: 0, deliveryAttempts: 0, opened: 0, issues: 0, uniqueContacts });
}

function attachmentKey(attachment: AdminRow) {
  return String(attachment.id ?? attachment.fileKey ?? attachment.url ?? attachment.fileName ?? "attachment");
}

function containsMergeFields(value: string) {
  return /{{\s*[^}]+\s*}}/.test(value);
}

export function PocCommunicationHistory({
  loading,
  communications,
  pocEmail
}: {
  loading: boolean;
  communications: AdminRow[];
  pocEmail?: string | null;
}) {
  if (loading) {
    return <Typography color="text.secondary">Loading POC email summary...</Typography>;
  }

  if (communications.length === 0) {
    return <EmptyState title="No sent POC emails yet" description="POC-facing email history will appear here after the first message is sent." />;
  }

  const summary = summarizeHistory(communications, pocEmail);
  const sortedCommunications = [...communications]
    .sort((a, b) => new Date(lastActivity(b) ?? 0).getTime() - new Date(lastActivity(a) ?? 0).getTime());

  return (
    <div className="poc-history-list">
      <div className="poc-history-summary" aria-label="POC sent email delivery summary">
        <div>
          <span>Email records</span>
          <strong>{summary.emailRecords}</strong>
        </div>
        <div>
          <span>Delivery attempts</span>
          <strong>{summary.deliveryAttempts}</strong>
        </div>
        <div>
          <span>Unique contacts</span>
          <strong>{summary.uniqueContacts}</strong>
        </div>
        <div className={summary.issues ? "is-alert" : ""}>
          <span>Issues</span>
          <strong>{summary.issues}</strong>
        </div>
      </div>
      <div className="poc-history-messages">
        {sortedCommunications.map((communication) => {
          const payload = payloadFor(communication);
          const subject = String(payload?.renderedSubject ?? communication.subject ?? "Email message");
          const body = plainBody(communication);
          const issue = communicationIssueLabel(communication);
          const recipients = recipientsFor(communication, pocEmail);
          const attachments = (communication.attachments ?? []) as AdminRow[];
          const chips = summaryChips(communication);
          const storedTemplateWarning = containsMergeFields(subject) || containsMergeFields(body);

          return (
            <details className={`poc-history-message ${issue === "Open issue" ? "is-alert" : ""}`} key={communication.id}>
              <summary className="poc-history-row">
                <div className="poc-history-main">
                  <div>
                    <small>{issue ? `! ${issue}` : "POC email"}</small>
                    <strong title={subject}>{subject}</strong>
                    <span>{recipients.length} contact{recipients.length === 1 ? "" : "s"}{attachments.length ? ` · ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}</span>
                  </div>
                  <div className="poc-history-row-actions">
                    <StatusChip value={communication.status} />
                    <DateBadge value={lastActivity(communication)} />
                  </div>
                </div>
                <div className="poc-history-chips">
                  {chips.map((chip) => <span key={chip}>{chip}</span>)}
                  {storedTemplateWarning ? <span className="is-alert-chip">Stored template copy</span> : null}
                </div>
              </summary>
              <div className="poc-history-detail">
                <div className="poc-history-detail-block">
                  <strong>Recipients</strong>
                  <p>{recipients.join(", ") || "Recipient not recorded"}</p>
                </div>
                {attachments.length ? (
                  <div className="poc-history-detail-block">
                    <strong>Attachments</strong>
                    <div className="poc-history-attachment-list">
                      {attachments.map((attachment) => (
                        <span key={attachmentKey(attachment)}>
                          {attachment.url ? <a href={String(attachment.url)} target="_blank" rel="noreferrer">{attachment.fileName ?? "Attachment"}</a> : attachment.fileName ?? "Attachment"}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="poc-history-detail-block">
                  <strong>{payload ? "Actual sent copy" : "Stored template copy"}</strong>
                  <p className="poc-history-body">{body || "No message body has been saved for this communication yet."}</p>
                </div>
                <div className="poc-history-row-footer">
                  <span>Open the full communication record for provider events, issue review, resend, and attachment management.</span>
                  <Button href={`/communications?search=${encodeURIComponent(recipients[0] ?? subject)}`} variant="outlined" size="small">Open</Button>
                </div>
              </div>
            </details>
          );
        })}
      </div>
      {pocEmail ? (
        <div className="poc-history-footer">
          <span>Showing POC-facing email records for {pocEmail}. Delivery attempts can be higher when a record has multiple provider events.</span>
          <Button href={`/communications?search=${encodeURIComponent(pocEmail)}`} variant="outlined" size="small">Open Communications</Button>
        </div>
      ) : null}
    </div>
  );
}
