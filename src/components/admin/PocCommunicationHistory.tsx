"use client";

import { Button, Typography } from "@/components/ui/primitives";
import { formatStatusLabel } from "@/lib/formatting";
import { AdminRow, DateBadge, EmptyState, StatusChip } from "./common";

function communicationIssueLabel(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  if (Number(summary.unreviewedIssueCount ?? 0) > 0) {
    return "Open issue";
  }
  if (Number(summary.reviewedIssueCount ?? 0) > 0) {
    return "Reviewed issue";
  }
  return null;
}

function summaryChips(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  const attachments = Number(communication.attachments?.length ?? 0);
  const chips = [
    Number(summary.sentCount ?? 0) > 0 ? `${summary.sentCount} sent` : "",
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

function summarizeHistory(communications: AdminRow[]) {
  return communications.reduce((summary, communication) => {
    const emailSummary = communication.emailSummary ?? {};
    return {
      messages: summary.messages + 1,
      sent: summary.sent + Number(emailSummary.sentCount ?? (communication.sentAt ? 1 : 0)),
      delivered: summary.delivered + Number(emailSummary.deliveredCount ?? 0),
      opened: summary.opened + Number(emailSummary.openedCount ?? 0),
      clicked: summary.clicked + Number(emailSummary.clickedCount ?? 0),
      issues: summary.issues + Number(emailSummary.unreviewedIssueCount ?? 0)
    };
  }, { messages: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, issues: 0 });
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

  const summary = summarizeHistory(communications);
  const sortedCommunications = [...communications]
    .sort((a, b) => new Date(lastActivity(b) ?? 0).getTime() - new Date(lastActivity(a) ?? 0).getTime());
  const latest = sortedCommunications[0];
  const latestIssue = latest ? communicationIssueLabel(latest) : null;
  const latestEvent = latest?.emailSummary?.lastEmailEvent ? formatStatusLabel(latest.emailSummary.lastEmailEvent) : "";
  const latestContext = [
    latest?.cohort?.title ?? latest?.communication?.cohort?.title ?? "Mission Control",
    latestEvent || formatStatusLabel(latest?.status)
  ].filter(Boolean).join(" · ");

  return (
    <div className="poc-history-list">
      <div className="poc-history-summary" aria-label="POC sent email delivery summary">
        <div>
          <span>Messages</span>
          <strong>{summary.messages}</strong>
        </div>
        <div>
          <span>Sent</span>
          <strong>{summary.sent}</strong>
        </div>
        <div>
          <span>Opened</span>
          <strong>{summary.opened}</strong>
        </div>
        <div className={summary.issues ? "is-alert" : ""}>
          <span>Issues</span>
          <strong>{summary.issues}</strong>
        </div>
      </div>
      {latest ? (
        <div className="poc-history-row">
          <div className="poc-history-main">
            <div>
              <small>Latest POC email</small>
              <strong title={latest.subject}>{latest.subject ?? "Email message"}</strong>
              <span title={latestContext}>{latestContext}</span>
            </div>
            <div className="poc-history-row-actions">
              {latestIssue ? <StatusChip value={latestIssue} /> : <StatusChip value={latest.status} />}
              <DateBadge value={lastActivity(latest)} />
            </div>
          </div>
          <div className="poc-history-chips">
            {summaryChips(latest).map((chip) => <span key={chip}>{chip}</span>)}
          </div>
        </div>
      ) : null}
      {pocEmail ? (
        <div className="poc-history-footer">
          <span>Open Communications for message body, provider events, issue review, resend, and attachment detail for {pocEmail}.</span>
          <Button href={`/communications?search=${encodeURIComponent(pocEmail)}`} variant="outlined" size="small">Open Communications</Button>
        </div>
      ) : null}
    </div>
  );
}
