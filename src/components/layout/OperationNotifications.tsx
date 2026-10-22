"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@/components/ui/primitives";
import { CloseIcon } from "@/components/ui/icons";
import { adminApi } from "@/lib/adminApi";
import { dismissOperation, hydrateOperations, operationSnapshot, serverOperationSnapshot, subscribeOperations, type AdminOperation } from "@/lib/adminOperations";

const labels: Record<string, string> = { primaryContactName: "POC name", primaryContactEmail: "POC email", primaryContactPhone: "POC phone", participantCount: "Team size", totalAmount: "Total amount", paymentStatus: "Payment status", paymentMethod: "Payment method", startTime: "Start time", endTime: "End time", meetingUrl: "Zoom / meeting link" };
const label = (key: string) => (labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()));
const hidden = new Set(["id", "registrationId", "cohortId", "organizationId", "presenterId", "sessionId", "backgroundDelivery"]);

export function OperationNotifications() {
  const operations = useSyncExternalStore(subscribeOperations, operationSnapshot, serverOperationSnapshot);
  const router = useRouter();
  const pathname = usePathname();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [showAll, setShowAll] = useState(false);
  const review = operations.find((operation) => operation.id === reviewId);
  const visible = operations.filter((operation) => !operation.dismissed).slice().reverse();
  useEffect(() => { hydrateOperations(); }, []);
  useEffect(() => {
    const timers = operations.filter((operation) => operation.state === "success" && !operation.dismissed).map((operation) => window.setTimeout(() => dismissOperation(operation.id), Math.max(0, 7000 - (Date.now() - (operation.finishedAt ?? operation.createdAt)))));
    return () => timers.forEach(window.clearTimeout);
  }, [operations]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (operationSnapshot().some((operation) => operation.state === "pending" && operation.change)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  function open(operation: AdminOperation) {
    router.push(operation.href as Route);
    if (operation.state === "error" && operation.change && operation.method !== "DELETE") { setDraft({ ...operation.change.values }); setReviewId(operation.id); }
  }
  async function retry() {
    if (!review?.change || !review.path || !["POST", "PATCH"].includes(review.method ?? "")) return;
    const captured = review;
    const request = adminApi(captured.path!, { method: captured.method as "POST" | "PATCH", body: { ...draft, id: captured.change?.id, deferNotifications: true } });
    setReviewId(null); dismissOperation(captured.id);
    await request.catch(() => undefined);
  }
  if (pathname === "/login") return null;
  return (
    <>
      <aside className="operation-notifications" aria-label="Save and background activity" aria-live="polite">
        {(showAll ? visible : visible.slice(0, 4)).map((operation) => (
          <article key={operation.id} className={`operation-notification is-${operation.state}`}>
            <button type="button" className="operation-notification-open" onClick={() => open(operation)}>
              <span className="operation-notification-icon" aria-hidden="true">{operation.state === "pending" ? <i /> : operation.state === "success" ? "✓" : operation.state === "warning" ? "!" : "×"}</span>
              <span><strong>{operation.state === "pending" ? "Saving / processing" : operation.state === "success" ? "Confirmed" : operation.state === "warning" ? "Needs attention" : "Could not confirm"}</strong><span>{operation.message}</span><small>{operation.state === "error" || operation.state === "warning" ? "Open to review and resolve" : "Open record"}</small></span>
            </button>
            <button type="button" className="operation-notification-dismiss" aria-label="Dismiss notification" onClick={() => dismissOperation(operation.id)}><CloseIcon /></button>
          </article>
        ))}
        {visible.length > 4 && <Button size="small" variant="outlined" onClick={() => setShowAll((old) => !old)}>{showAll ? "Show fewer updates" : `${visible.length - 4} more updates`}</Button>}
      </aside>
      <Dialog open={Boolean(review)} onClose={() => setReviewId(null)} fullWidth maxWidth="md">
        <DialogTitle>Review unsaved changes</DialogTitle>
        <DialogContent>
          <Alert severity="error">{review?.error}</Alert>
          {review?.method === "POST" && !review.errorConfirmed && <p>The server did not confirm whether the record was created. Check the record list before creating another copy. Your submitted values are retained here.</p>}
          <div className="operation-recovery-fields">
            {Object.entries(draft).filter(([key]) => !hidden.has(key)).map(([key, value]) => Array.isArray(value) ? (
              <fieldset key={key}><legend>{label(key)}</legend>{value.map((row, index) => <div className="operation-recovery-nested" key={index}>{Object.entries(row).filter(([field]) => !hidden.has(field)).map(([field, fieldValue]) => <TextField key={field} label={`${key === "sessions" ? "Session" : "Participant"} ${index + 1} · ${label(field)}`} value={fieldValue ?? ""} onChange={(event) => setDraft((old) => ({ ...old, [key]: old[key].map((item: any, i: number) => i === index ? { ...item, [field]: event.target.value } : item) }))} />)}</div>)}</fieldset>
            ) : typeof value === "boolean" ? <label key={key}><input type="checkbox" checked={value} onChange={(event) => setDraft((old) => ({ ...old, [key]: event.target.checked }))} />{label(key)}</label>
              : <TextField key={key} label={label(key)} value={value ?? ""} type={typeof value === "number" ? "number" : key.toLowerCase().includes("email") ? "email" : "text"} onChange={(event) => setDraft((old) => ({ ...old, [key]: typeof value === "number" ? Number(event.target.value) : event.target.value }))} />)}
          </div>
        </DialogContent>
        <DialogActions><Button variant="outlined" onClick={() => setReviewId(null)}>Keep for later</Button>{(review?.method === "PATCH" || review?.errorConfirmed) && <Button onClick={() => void retry()}>Save corrected changes</Button>}</DialogActions>
      </Dialog>
    </>
  );
}
