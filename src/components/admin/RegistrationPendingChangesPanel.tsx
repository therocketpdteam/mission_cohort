"use client";

import { useMemo, useState } from "react";
import { Button, Typography } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay } from "@/lib/formatting";
import { AdminRow, StatusChip } from "./common";

const fieldLabels: Record<string, string> = {
  participantCount: "Participant seats",
  totalAmount: "Registration total",
  purchaseOrderNumber: "PO number",
  invoiceNumber: "Invoice number"
};

function formatValue(field: string, value: unknown) {
  if (field === "totalAmount") {
    return `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return value === null || value === undefined || value === "" ? "None" : String(value);
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function blockedSafetyRecipients(registration: AdminRow) {
  const blocked = new Set<string>();
  for (const communication of (registration.communications ?? []) as AdminRow[]) {
    const providerError = String(communication.providerError ?? "");
    if (!providerError.toLowerCase().includes("outbound safety mode blocked")) {
      continue;
    }
    if (Array.isArray(communication.recipientEmails)) {
      communication.recipientEmails.forEach((email) => {
        const normalized = normalizeEmail(email);
        if (normalized) {
          blocked.add(normalized);
        }
      });
    }
  }
  return [...blocked];
}

export function RegistrationPendingChangesPanel({
  registration,
  onApplied,
  onError
}: {
  registration: AdminRow;
  onApplied: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [applying, setApplying] = useState(false);
  const pending = registration.pendingChanges && typeof registration.pendingChanges === "object" && !Array.isArray(registration.pendingChanges)
    ? registration.pendingChanges as AdminRow
    : null;
  const additions = Array.isArray(pending?.participantAdditions) ? pending.participantAdditions : [];
  const removals = Array.isArray(pending?.participantRemovals) ? pending.participantRemovals : [];
  const fields = pending?.fields && typeof pending.fields === "object" && !Array.isArray(pending.fields)
    ? Object.entries(pending.fields as Record<string, AdminRow>)
    : [];
  const rows = useMemo(() => [
    ...additions.map((row: AdminRow) => ({ key: `add-${row.participantId}`, label: "Participant added", value: `${formatProperDisplay(`${row.firstName} ${row.lastName}`)} · ${row.email}`, tone: "Added" })),
    ...removals.map((row: AdminRow) => ({ key: `remove-${row.participantId}`, label: "Participant removed", value: `${formatProperDisplay(`${row.firstName} ${row.lastName}`)} · ${row.email}`, tone: "Removed" })),
    ...fields.map(([field, change]) => ({ key: field, label: fieldLabels[field] ?? field, value: `${formatValue(field, change.before)} → ${formatValue(field, change.after)}`, tone: "Changed" }))
  ], [additions, fields, removals]);
  const blockedRecipients = blockedSafetyRecipients(registration);
  const pocEmail = normalizeEmail(registration.primaryContactEmail);
  const deliveryImpacts = [
    additions.length ? `${additions.length} new participant${additions.length === 1 ? "" : "s"} will receive registration confirmation emails.` : "",
    removals.length ? `${removals.length} removed participant${removals.length === 1 ? "" : "s"} will be removed from future linked Google events.` : "",
    additions.length || removals.length ? "Future linked Google calendar events update once when Apply runs." : "",
    fields.some(([field]) => ["participantCount", "totalAmount", "purchaseOrderNumber", "invoiceNumber"].includes(field))
      ? "Invoice-related fields may refresh the simple invoice/PDF before the POC summary is sent."
      : "",
    pocEmail ? `A consolidated POC summary sends to ${pocEmail}.` : "A POC email is required before the summary can be sent.",
    blockedRecipients.length ? `Safety mode has blocked: ${blockedRecipients.join(", ")}.` : ""
  ].filter(Boolean);

  if (!pending || rows.length === 0) {
    return null;
  }

  async function applyChanges() {
    setApplying(true);
    try {
      const result = await adminApi<AdminRow>("/api/registrations", {
        method: "PATCH",
        body: { id: registration.id, action: "applyChanges" }
      });
      await onApplied(result.status === "applied" ? "Registration changes applied and notifications sent." : "Pending registration changes cleared.");
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="registration-change-review">
      <div className="registration-change-review-header">
        <div>
          <span>Pending delivery</span>
          <strong>{rows.length} registration change{rows.length === 1 ? "" : "s"}</strong>
          <Typography color="text.secondary">Saved in Mission Control. Calendar and email updates wait for Apply.</Typography>
        </div>
        <Button onClick={applyChanges} disabled={applying}>{applying ? "Applying" : "Apply Changes"}</Button>
      </div>
      <div className="quick-view-list">
        {rows.map((row) => (
          <div className="quick-view-list-row" key={row.key}>
            <div><strong>{row.label}</strong><span>{row.value}</span></div>
            <StatusChip value={row.tone} />
          </div>
        ))}
      </div>
      <div className="registration-change-impact">
        <strong>Apply will coordinate</strong>
        <ul>
          {deliveryImpacts.map((impact) => <li key={impact}>{impact}</li>)}
        </ul>
      </div>
    </div>
  );
}
