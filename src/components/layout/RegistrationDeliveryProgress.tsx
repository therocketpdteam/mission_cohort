"use client";

import { CheckCircleOutline, CloseIcon, WarningAmberOutlined } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import { useCallback, useEffect, useRef, useState } from "react";

type TrackedJob = {
  id: string;
  label: string;
  status?: string;
  payload?: { stage?: string; progress?: number; cursor?: number; totalParticipants?: number };
  errorMessage?: string | null;
};

const storageKey = "mission-cohort-registration-delivery-jobs";

function readJobs(): TrackedJob[] {
  try { return JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); } catch { return []; }
}

export function RegistrationDeliveryProgress() {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const processing = useRef(new Set<string>());

  const persist = useCallback((next: TrackedJob[]) => {
    setJobs(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }, []);

  useEffect(() => {
    setJobs(readJobs());
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<TrackedJob>).detail;
      const current = readJobs().filter((job) => job.id !== detail.id);
      persist([{ ...detail, status: "QUEUED", payload: { stage: "POC", progress: 5 } }, ...current]);
    };
    window.addEventListener("registration-delivery-job", listener);
    return () => window.removeEventListener("registration-delivery-job", listener);
  }, [persist]);

  useEffect(() => {
    if (jobs.length === 0) return;
    let active = true;
    const tick = async () => {
      const current = readJobs();
      if (!current.length) return;
      try {
        const remote = await adminApi<TrackedJob[]>(`/api/registration-delivery-jobs?ids=${current.map((job) => job.id).join(",")}`);
        if (!active) return;
        const merged = current.map((local) => ({ ...local, ...(remote.find((job) => job.id === local.id) ?? {}) }));
        persist(merged);
        for (const job of merged) {
          if (job.status !== "QUEUED" || processing.current.has(job.id)) continue;
          processing.current.add(job.id);
          adminApi(`/api/registration-delivery-jobs`, { method: "POST", body: { id: job.id } })
            .catch(() => undefined)
            .finally(() => processing.current.delete(job.id));
        }
      } catch {
        // Keep the card visible and retry; the durable job remains in the database.
      }
    };
    void tick();
    const interval = window.setInterval(tick, 1500);
    return () => { active = false; window.clearInterval(interval); };
  }, [jobs.length, persist]);

  if (!jobs.length) return null;

  return (
    <aside className="registration-delivery-progress" aria-live="polite" aria-label="Registration delivery progress">
      {jobs.map((job) => {
        const complete = job.status === "COMPLETED";
        const failed = job.status === "FAILED";
        const progress = complete ? 100 : Math.max(3, Number(job.payload?.progress ?? 5));
        const stage = job.payload?.stage === "POC" ? "Preparing invoice and POC email"
          : job.payload?.stage === "PARTICIPANTS" ? `Delivering participant ${Math.min(Number(job.payload?.cursor ?? 0), Number(job.payload?.totalParticipants ?? 0))} of ${job.payload?.totalParticipants ?? ""}`
            : job.payload?.stage === "CRM" ? "Finishing CRM handoff" : "Preparing registration";
        return (
          <article className={`registration-delivery-progress-card${failed ? " is-failed" : complete ? " is-complete" : ""}`} key={job.id}>
            <div className="registration-delivery-progress-heading">
              <div className="registration-delivery-progress-icon">{failed ? <WarningAmberOutlined /> : complete ? <CheckCircleOutline /> : <span className="registration-delivery-spinner" />}</div>
              <div><strong>{complete ? "Registration ready" : failed ? "Registration needs attention" : "Setting up registration"}</strong><span>{job.label}</span></div>
              <IconButton size="small" aria-label="Dismiss progress" onClick={() => persist(readJobs().filter((item) => item.id !== job.id))}><CloseIcon /></IconButton>
            </div>
            <div className="registration-delivery-progress-track"><span style={{ width: `${progress}%` }} /></div>
            <p>{failed ? job.errorMessage : complete ? "Invoice, communications, calendar enrollment, and reminders are complete. CRM handoff is queued." : stage}</p>
          </article>
        );
      })}
    </aside>
  );
}
