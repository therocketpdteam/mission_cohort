"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function SessionPostSessionEmail({ cohortId, cohortTitle, session, message, now, refresh }: {
  cohortId: string; cohortTitle: string; session: { id: string; title: string; startTime: string; endTime: string; timezone: string; recordingUrl?: string | null };
  message?: PostSessionSummary; now: number; refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!message) return null;
  const stamp = (value: string) => `${formatDateTimeInZone(value, session.timezone)} (${session.timezone})`;
  const window = postSessionWindow({ ...message, template: { type: "FOLLOW_UP" } }, session, now);
  const eligible = message.eligible && window.eligible && message.recipientCount > 0;
  const ended = now >= new Date(session.endTime).getTime();
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
    {message.status === "SENT" ? <Typography variant="caption">Post-session email · Sent{message.sentAt ? ` ${stamp(message.sentAt)}` : ""}</Typography> : message.status === "SENDING" ? <Typography variant="caption">Post-session email · Sending — refreshes automatically</Typography> : <>
      {eligible ? <Button size="small" variant="outlined" onClick={() => { setError(""); setOpen(true); }}>{message.status === "FAILED" ? "Retry Unsent Post-Session Email" : "Send Post-Session Email Now"}</Button> : null}
      {ended && !eligible ? <Typography variant="caption">Post-session email · {message.recipientCount === 0 ? "No recipients configured." : window.reason ?? message.reason}</Typography> : null}
      {message.status === "FAILED" ? <Typography variant="caption" color="error">Delivery needs attention: {message.providerError ?? "Delivery failed. Retry skips confirmed recipients."}</Typography> : null}
    </>}
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
