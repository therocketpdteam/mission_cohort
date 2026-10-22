"use client";

import { dismissOperation, operationSnapshot, publishOperationNotice } from "@/lib/adminOperations";
import { adminApi } from "@/lib/adminApi";
import { useCallback, useEffect, useRef, useState } from "react";

type TrackedJob = {
  id: string;
  label: string;
  entityId?: string;
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
        const retained = new Set(readJobs().map((job) => job.id));
        const merged = current.filter((job) => retained.has(job.id)).map((local) => ({ ...local, ...(remote.find((job) => job.id === local.id) ?? {}) }));
        persist(merged);
        for (const job of merged) {
          if (job.status !== "QUEUED" || processing.current.has(job.id)) continue;
          processing.current.add(job.id);
          adminApi(`/api/registration-delivery-jobs`, { method: "POST", body: { id: job.id }, notify: false })
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

  useEffect(() => {
    for (const job of jobs) {
      const complete = job.status === "COMPLETED";
      const failed = job.status === "FAILED";
      const stage = job.payload?.stage === "POC" ? "Preparing invoice and POC email"
        : job.payload?.stage === "PARTICIPANTS" ? `Delivering participant ${Math.min(Number(job.payload?.cursor ?? 0), Number(job.payload?.totalParticipants ?? 0))} of ${job.payload?.totalParticipants ?? ""}`
          : job.payload?.stage === "CRM" ? "Finishing CRM handoff" : "Preparing registration";
      // Replace the initial 'saved, delivery pending' notice with durable progress.
      for (const entry of operationSnapshot()) if (!entry.dismissed && entry.result?.deliveryJob?.id === job.id) dismissOperation(entry.id);
      publishOperationNotice({ id: `registration-job:${job.id}`, state: failed ? "error" : complete ? "success" : "pending",
        message: `${job.label} · ${failed ? job.errorMessage || "Registration setup needs review." : complete ? "Registration setup finished. Open the record to review delivery." : `${stage} (${Math.max(3, Number(job.payload?.progress ?? 5))}%)`}`,
        href: job.entityId ? `/registrations?id=${encodeURIComponent(job.entityId)}` : "/registrations",
        onDismiss: () => persist(readJobs().filter((item) => item.id !== job.id))
      });
    }
  }, [jobs, persist]);
  return null;
}
