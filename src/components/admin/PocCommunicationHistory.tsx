"use client";

import { useState } from "react";
import { Button, Typography } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
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
  pocEmail,
  onChanged,
  onSuccess,
  onError
}: {
  loading: boolean;
  communications: AdminRow[];
  pocEmail?: string | null;
  onChanged?: () => Promise<void> | void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const [resendingId, setResendingId] = useState("");

  async function resendToPoc(communication: AdminRow) {
    if (!pocEmail || !communication.id) {
      onError?.("POC email is required before resending.");
      return;
    }

    setResendingId(communication.id);

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendToRecipient", communicationId: communication.id, recipientEmail: pocEmail }
      });
      onSuccess?.(`Message resent to ${pocEmail}.`);
      await onChanged?.();
    } catch (error) {
      onError?.((error as Error).message);
    } finally {
      setResendingId("");
    }
  }

  if (loading) {
    return <Typography color="text.secondary">Loading communication history...</Typography>;
  }

  if (communications.length === 0) {
    return <EmptyState title="No sent POC emails yet" description="Manual and automatic outbound emails this POC receives will appear here with delivery, open, click, bounce, and failure signals." />;
  }

  const summary = summarizeHistory(communications);
  const sortedCommunications = [...communications]
    .sort((a, b) => new Date(lastActivity(b) ?? 0).getTime() - new Date(lastActivity(a) ?? 0).getTime());

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
      <div className="poc-history-latest-label">
        <span>Sent email timeline</span>
        <small>{communications.length} message{communications.length === 1 ? "" : "s"} received by this POC</small>
      </div>
      {sortedCommunications.map((communication) => {
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
            <div className="poc-history-row-footer">
              <span>Use this row when a POC asks whether a message was sent or opened.</span>
              <Button
                variant="outlined"
                size="small"
                disabled={!pocEmail || Boolean(resendingId)}
                onClick={() => resendToPoc(communication)}
              >
                {resendingId === communication.id ? "Resending" : "Resend"}
              </Button>
            </div>
          </div>
        );
      })}
      {pocEmail ? (
        <div className="poc-history-footer">
          <span>Open Communications for message body, recipient event history, issue review, and attachment detail for {pocEmail}.</span>
          <Button href={`/communications?search=${encodeURIComponent(pocEmail)}`} variant="outlined" size="small">Open Communications</Button>
        </div>
      ) : null}
    </div>
  );
}
