"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import { formatStatusLabel } from "@/lib/formatting";
import type { AdminRow } from "./common";
import type { CancellationNotificationMode } from "@/modules/cohorts/cancellation";

type CohortStatusChangePreview = {
  notificationMode: CancellationNotificationMode;
  cohort: {
    id: string;
    title: string;
    currentStatus: string;
    nextStatus: string;
    participantCount: number;
    registrationCount: number;
  };
  automaticEmails: AdminRow[];
  unsentCommunications: AdminRow[];
  unsentCommunicationCount: number;
  recentSentCommunications: AdminRow[];
  linkedCalendarEvents: AdminRow[];
  warnings: string[];
  blockers?: string[];
};

function shortDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
}

export function CohortCancellationDialog({ cohort, onClose, onCancelled }: {
  cohort: { id: string; title: string; status: string };
  onClose: () => void;
  onCancelled: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<CohortStatusChangePreview | null>(null);
  const [loadingStatusChangeReview, setLoadingStatusChangeReview] = useState(true);
  const [applyingStatusChange, setApplyingStatusChange] = useState(false);
  const [error, setError] = useState("");
  const [notificationMode, setNotificationMode] = useState<CancellationNotificationMode>("notify");
  const silent = notificationMode === "silent";
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError("");
    setLoadingStatusChangeReview(true);
    adminApi<CohortStatusChangePreview>(`/api/cohorts/${cohort.id}?action=statusChangePreview&nextStatus=CANCELLED&notificationMode=${notificationMode}`)
      .then((result) => { if (active) setPreview(result); })
      .catch((error: Error) => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoadingStatusChangeReview(false); });
    return () => { active = false; };
  }, [cohort.id, notificationMode]);

  async function applyReviewedStatusChange() {
    if (submitting.current || loadingStatusChangeReview || !preview || preview.notificationMode !== notificationMode || preview.blockers?.length) return;
    submitting.current = true;
    setApplyingStatusChange(true);
    setError("");
    try {
      await adminApi(`/api/cohorts/${cohort.id}`, { method: "PATCH", body: { action: "cancel", notificationMode } });
    } catch (error) {
      setError((error as Error).message);
      return;
    } finally {
      submitting.current = false;
      setApplyingStatusChange(false);
    }
    onClose();
    await onCancelled();
  }

  return (
    <Dialog open onClose={() => !applyingStatusChange && onClose()} maxWidth="lg" fullWidth>
      <DialogTitle>Cancel Cohort</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {cohort ? (
          <Stack spacing={2}>
            <Alert severity="warning">
              {cohort.title} will move from {formatStatusLabel(preview?.cohort.currentStatus ?? cohort.status)} to {formatStatusLabel("CANCELLED")}.
            </Alert>
            <TextField select fullWidth label="Cancellation notifications" value={notificationMode} disabled={applyingStatusChange} onChange={event => {
              setPreview(null);
              setLoadingStatusChangeReview(true);
              setNotificationMode(event.target.value as CancellationNotificationMode);
            }}>
              <MenuItem value="notify">Notify POCs and participants</MenuItem>
              <MenuItem value="silent">Cancel silently — people already notified</MenuItem>
            </TextField>
            {silent ? <Alert severity="info">No cancellation emails or calendar notifications will be sent. Use this when people have already been notified separately. Existing refunds and registrations moved to other cohorts are preserved.</Alert> : null}
            {loadingStatusChangeReview ? (
              <Typography color="text.secondary">Checking emails, scheduled actions, and calendar links...</Typography>
            ) : preview ? (
              <>
                <div className="stage-review-summary">
                  <div>
                    <span>Automatic emails</span>
                    <strong>{preview.automaticEmails.length}</strong>
                    <small>{silent ? "No cancellation emails will be created or sent." : "POCs receive administrative details; participants receive the general notice."}</small>
                  </div>
                  <div>
                    <span>Unsent emails paused</span>
                    <strong>{preview.unsentCommunicationCount}</strong>
                    <small>Pending reminders are paused; messages already sending must finish before cancellation.</small>
                  </div>
                  <div>
                    <span>Linked calendar events</span>
                    <strong>{preview.linkedCalendarEvents.length}</strong>
                    <small>{silent ? "Future invitations are removed without attendee notifications." : "Future invitations are removed after the email provider accepts the notices."}</small>
                  </div>
                </div>
                {preview.recentSentCommunications.length > 0 ? (
                  <div className="stage-review-panel">
                    <span>Recently Sent Emails</span>
                    {preview.recentSentCommunications.slice(0, 5).map((communication) => (
                      <div className="stage-review-row" key={communication.id}>
                        <strong>{communication.subject}</strong>
                        <small>{shortDateTime(communication.sentAt)}{communication.templateName ? ` · ${communication.templateName}` : ""}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert severity="info">No sent emails were found for this cohort yet.</Alert>
                )}
                {preview.unsentCommunications.length > 0 ? (
                  <div className="stage-review-panel">
                    <span>Emails That Will Be Paused</span>
                    {preview.unsentCommunications.slice(0, 6).map((communication) => (
                      <div className="stage-review-row" key={communication.id}>
                        <strong>{communication.subject}</strong>
                        <small>{formatStatusLabel(communication.status)} · {shortDateTime(communication.scheduledFor)}{communication.sessionTitle ? ` · ${communication.sessionTitle}` : ""}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {preview.linkedCalendarEvents.length > 0 ? (
                  <Alert severity="info">
                    {silent ? "Future calendar invitations are removed silently. No Google cancellation notifications will be sent." : "Google will notify attendees as future invitations are removed. The cohort and its registrations and participants are marked Cancelled only after the email and calendar steps succeed."}
                  </Alert>
                ) : null}
                {preview.warnings.map((warning) => <Alert severity="info" key={warning}>{warning}</Alert>)}
                {(preview.blockers ?? []).map((blocker) => <Alert severity="error" key={blocker}>{blocker}</Alert>)}
                {preview.automaticEmails.map((notice) => (
                  <details className="stage-review-panel" key={notice.journeyKey}>
                    <summary>{notice.role === "poc" ? "POC" : "Participant"}: {notice.email}</summary>
                    <Typography variant="subtitle2">{notice.subject}</Typography>
                    <Typography component="div" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{notice.bodyText}</Typography>
                  </details>
                ))}
              </>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={applyingStatusChange}>Back</Button>
        <Button
          color="error"
          onClick={() => void applyReviewedStatusChange()}
          disabled={applyingStatusChange || loadingStatusChangeReview || !preview || preview.notificationMode !== notificationMode || Boolean(preview?.blockers?.length)}
        >
          {applyingStatusChange ? "Cancelling" : silent ? "Cancel Cohort Silently" : "Send Notices & Cancel Cohort"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
