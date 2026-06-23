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
    return <Typography color="text.secondary">Loading communication history...</Typography>;
  }

  if (communications.length === 0) {
    return <EmptyState title="No POC emails yet" description="Manual and automatic outbound emails to this POC will appear here with delivery and open signals." />;
  }

  return (
    <div className="poc-history-list">
      {communications.map((communication) => {
        const issue = communicationIssueLabel(communication);
        const lastEvent = communication.emailSummary?.lastEmailEvent ? formatStatusLabel(communication.emailSummary.lastEmailEvent) : "";
        const context = [communication.cohort?.title ?? communication.communication?.cohort?.title ?? "Mission Control", lastEvent].filter(Boolean).join(" · ");

        return (
          <div className="poc-history-row" key={communication.id}>
            <div className="poc-history-main">
              <div>
                <strong title={communication.subject}>{communication.subject ?? "Email event"}</strong>
                <span title={context}>{context}</span>
              </div>
              <div className="poc-history-row-actions">
                {issue ? <StatusChip value={issue} /> : <StatusChip value={communication.status} />}
                <DateBadge value={lastActivity(communication)} />
              </div>
            </div>
            <div className="poc-history-chips">
              {summaryChips(communication).map((chip) => <span key={chip}>{chip}</span>)}
            </div>
          </div>
        );
      })}
      {pocEmail ? (
        <div className="poc-history-footer">
          <span>Showing message-level summaries for {pocEmail}. Open Communications for recipient events and review actions.</span>
          <Button href={`/communications?search=${encodeURIComponent(pocEmail)}`} variant="outlined" size="small">Open Communications</Button>
        </div>
      ) : null}
    </div>
  );
}

