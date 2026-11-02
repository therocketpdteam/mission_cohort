"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import type { CancellationNotificationMode } from "@/modules/cohorts/cancellation";
import type { AdminRow } from "./common";

export function BulkRegistrationCancellationDialog({ registrationIds, onClose, onCancelled, onSuccess, onError }: {
  registrationIds: string[]; onClose: () => void; onCancelled: () => Promise<void>;
  onSuccess: (message: string) => void; onError: (message: string) => void;
}) {
  const [notificationMode, setNotificationMode] = useState<CancellationNotificationMode>("notify");
  const [previews, setPreviews] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const idsKey = JSON.stringify([...registrationIds].sort());
  const silent = notificationMode === "silent";

  useEffect(() => {
    let active = true;
    setPreviews(null); setError("");
    Promise.all((JSON.parse(idsKey) as string[]).map(id => adminApi<AdminRow>("/api/registrations", {
      method: "PATCH", body: { id, action: "previewCancellation", notificationMode }
    }))).then(rows => { if (active) setPreviews(rows); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [idsKey, notificationMode]);

  const blockers = previews?.flatMap(p => p.blockers ?? []) ?? [];
  const ready = registrationIds.length > 0 && previews?.length === registrationIds.length && previews.every(p => p.notificationMode === notificationMode) && !blockers.length && !error;
  async function cancel() {
    if (!ready || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await adminApi<AdminRow>("/api/registrations", { method: "PATCH", body: { action: "bulk", bulkAction: "cancel", ids: registrationIds, notificationMode } });
      if (result.emailFailures?.length) onError("Registrations cancelled, but some POC emails need review in Communications.");
      else onSuccess(silent ? `${registrationIds.length} registrations cancelled silently` : `${registrationIds.length} registrations cancelled and POCs notified`);
      await onCancelled(); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
    <DialogTitle>Cancel {registrationIds.length} registrations</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Alert severity="warning">Only the selected registrations will be cancelled. Other active registrations stay intact. Refunds are not issued automatically.</Alert>
      <TextField select fullWidth label="Cancellation notifications" value={notificationMode} disabled={busy} onChange={event => { setPreviews(null); setNotificationMode(event.target.value as CancellationNotificationMode); }}>
        <MenuItem value="notify">Send each POC a cancellation email</MenuItem>
        <MenuItem value="silent">Cancel silently — people already notified</MenuItem>
      </TextField>
      {silent ? <Alert severity="info">No cancellation emails or calendar notifications will be sent. Pending messages for the selected registrations will stop.</Alert> : null}
      {!previews && !error ? <Typography>Checking each registration before cancellation...</Typography> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {blockers.map((blocker: string, index: number) => <Alert severity="error" key={index}>{blocker}</Alert>)}
      {previews?.map(p => <details key={p.registration.id}><summary>{p.registration.primaryContactName} · {p.registration.invoiceNumber ?? "No invoice"}</summary>
        <Typography>{p.registration.cohortShortName ?? p.registration.cohortTitle}</Typography>
        {!silent ? <Typography component="div" sx={{ whiteSpace: "pre-wrap" }}>To: {p.email.to}{"\n"}{p.email.subject}{"\n\n"}{p.email.bodyText}</Typography> : null}
      </details>)}
    </Stack></DialogContent>
    <DialogActions><Button variant="outlined" onClick={onClose} disabled={busy}>Back</Button><Button color="error" disabled={busy || !ready} onClick={() => void cancel()}>{busy ? "Cancelling..." : silent ? "Cancel Registrations Silently" : "Cancel and Notify POCs"}</Button></DialogActions>
  </Dialog>;
}
