"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { postSessionPresentation } from "./cohortOverviewPresentation";
import { adminApi } from "@/lib/adminApi";
import { postSessionWindow } from "@/lib/postSessionSendNow";
import { formatDateTimeInZone } from "@/lib/timezones";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@/components/ui/primitives";

export type PostSessionSummary = { id: string; sessionId: string; status: string; sentAt: string | null; scheduledFor: string; recipientCount: number; providerError?: string | null; eligible: boolean; reason?: string | null };
export function useSessionPostSessionEmails(cohortId: string) {
  const [messages, setMessages] = useState<PostSessionSummary[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const sequence = useRef(0);
  const invalidate = useCallback(() => { ++sequence.current; }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const rows = await adminApi<PostSessionSummary[]>(`/api/cohorts/${cohortId}/post-session-emails`);
      if (request === sequence.current) { setMessages(rows); setError(""); }
    } catch (failure) { if (request === sequence.current) { setError((failure as Error).message); setMessages([]); } }
  }, [cohortId]);
  useEffect(() => {
    setMessages([]); void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { invalidate(); clearInterval(timer); clearInterval(clock); window.removeEventListener("focus", focus); };
  }, [refresh, invalidate]);
  return { messages, refresh, now, error };
}

export function SessionPostSessionEmail({ cohortId, cohortTitle, session, message, now, refresh, onEditSession }: {
  cohortId: string; cohortTitle: string; session: { id: string; title: string; startTime: string; endTime: string; timezone: string; recordingUrl?: string | null };
  message?: PostSessionSummary; now: number; refresh: () => Promise<void>; onEditSession?: () => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  if (!message) return <div className="session-post-session-email"><span className="overview-status is-neutral">Post-session email · Status unavailable</span></div>;
  const stamp = (value: string) => `${formatDateTimeInZone(value, session.timezone)} (${session.timezone})`;
  const window = postSessionWindow({ ...message, template: { type: "FOLLOW_UP" } }, session, now);
  const eligible = message.eligible && window.eligible && message.recipientCount > 0;
  const ended = now >= new Date(session.endTime).getTime();
  const presentation = postSessionPresentation(message, eligible, ended, now);
  async function send() {
    if (!message || !eligible || busy) return;
    setBusy(true); setError("");
    try {
      await adminApi("/api/communications", { method: "PATCH", body: { action: "sendPostSessionNow", id: message.id, cohortId, sessionId: session.id } });
      setOpen(false); await refresh();
    } catch (failure) { setError((failure as Error).message); await refresh(); }
    finally { setBusy(false); }
  }
  return <div className="session-post-session-email">
    <div className="session-email-status-line">
      <span className={`overview-status is-${presentation.tone}`}>Post-session email · {presentation.label}</span>
      {message.status === "SENT" && message.sentAt ? <Typography variant="caption">{stamp(message.sentAt)}</Typography> : null}
      {message.status === "SCHEDULED" && !presentation.review ? <Typography variant="caption">Scheduled for {stamp(message.scheduledFor)}</Typography> : null}
    </div>
    <div className="session-email-actions">
      {eligible && !presentation.review ? <Button size="small" variant="outlined" onClick={() => { setError(""); setOpen(true); }}>Send Post-Session Email Now</Button> : null}
      {presentation.review ? <Button size="small" variant="outlined" onClick={() => setReviewOpen(true)}>Review Email</Button> : null}
    </div>
    <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} fullWidth maxWidth="sm">
      <div role="dialog" aria-modal="true" aria-label="Review post-session email">
        <DialogTitle>Review post-session email</DialogTitle>
        <DialogContent><Stack spacing={1.5}>
          <Typography><strong>{cohortTitle}</strong></Typography>
          <Typography>{session.title} · {stamp(session.startTime)}</Typography>
          <Typography>Email type: 24 Hours Post Session · Recipients: {message.recipientCount}</Typography>
          <Typography>Scheduled delivery: {stamp(message.scheduledFor)}</Typography>
          <Alert severity={presentation.tone === "failure" ? "error" : "warning"}>{presentation.configuration ? "Sending is blocked by configuration. This does not confirm a delivery attempt." : presentation.label}</Alert>
          <Typography>{message.providerError || (message.recipientCount === 0 ? "No recipients configured." : window.reason ?? message.reason)}</Typography>
          <Typography>Retries use the existing email and skip confirmed recipients. Uncertain provider outcomes require review. The existing early-send window still applies.</Typography>
        </Stack></DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setReviewOpen(false)}>Close</Button>
          {presentation.configuration ? <Button component="a" href="/settings" variant="outlined">Review Settings</Button> : null}
          {onEditSession && /recording/i.test(window.reason ?? "") ? <Button onClick={() => { setReviewOpen(false); onEditSession(); }}>Edit session</Button> : null}
          {eligible ? <Button onClick={() => { setReviewOpen(false); setError(""); setOpen(true); }}>{message.status === "FAILED" ? "Retry Unsent Post-Session Email" : "Send Post-Session Email Now"}</Button> : null}
        </DialogActions>
      </div>
    </Dialog>
    <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm">
      <div role="dialog" aria-modal="true" aria-label="Send post-session email now">
      <DialogTitle>Send post-session email now?</DialogTitle>
      <DialogContent><Stack spacing={1.5}>
        <Typography><strong>{cohortTitle}</strong></Typography>
        <Typography>{session.title} · {stamp(session.startTime)}</Typography>
        <Typography>Email type: 24 Hours Post Session</Typography>
        <Typography>Recipients: {message.recipientCount}</Typography>
        <Typography>Scheduled delivery: {stamp(message.scheduledFor)}</Typography>
        <Typography>This sends the existing email with its configured content and recording links. Confirm that the recording is ready. Its scheduled delivery will not send another copy. Retrying skips confirmed recipients; uncertain deliveries require provider review.</Typography>
        {!eligible ? <Alert severity="warning">{window.reason ?? message.reason ?? "This email is no longer available for early sending."}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack></DialogContent>
      <DialogActions><Button variant="outlined" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !eligible} onClick={send}>{busy ? "Sending…" : "Confirm Send Now"}</Button></DialogActions>
      </div>
    </Dialog>
  </div>;
}
