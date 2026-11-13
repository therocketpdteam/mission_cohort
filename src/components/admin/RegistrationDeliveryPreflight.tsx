"use client";

import { FinancialRosterReconciliation } from "./FinancialRosterReconciliation";
import { reconcileFinancialRoster } from "@/lib/financialRosterReconciliation";
import { Button, Typography } from "@/components/ui/primitives";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { countPendingRegistrationChanges } from "@/lib/registrationPendingChanges";
import { AdminRow, StatusChip } from "./common";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function pendingFrom(registration: AdminRow) {
  return registration.pendingChanges && typeof registration.pendingChanges === "object" && !Array.isArray(registration.pendingChanges)
    ? registration.pendingChanges as AdminRow
    : null;
}

function blockedSafetyRecipients(registration: AdminRow) {
  const communications = (registration.communications ?? []) as AdminRow[];
  const blocked = new Set<string>();

  for (const communication of communications) {
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

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function rosterStatusFromCounts(expected: number, actual: number) {
  if (expected === 0 && actual === 0) {
    return "NOT_REQUESTED";
  }
  if (expected === 0 || actual >= expected) {
    return "COMPLETE";
  }
  if (actual > 0) {
    return "PARTIAL";
  }
  return "NEEDED";
}

export function RegistrationDeliveryPreflight({
  registration,
  onAddPrimaryContact,
  onFinancialReview
}: {
  registration: AdminRow;
  onAddPrimaryContact?: () => Promise<void> | void;
  onFinancialReview?: () => Promise<void> | void;
}) {
  const reconciliation = reconcileFinancialRoster(registration);
  const expected = Number(registration.participantCount ?? 0);
  const participants = ((registration.participants ?? []) as AdminRow[]).filter((participant) => (!participant.status || participant.status === "REGISTERED") && normalizeEmail(participant.email));
  const actual = reconciliation.savedParticipants;
  const missing = Math.max(expected - actual, 0);
  const participantEmails = [...new Set(participants.map((participant) => normalizeEmail(participant.email)).filter(email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  const pocEmail = normalizeEmail(registration.primaryContactEmail);
  const pocOnRoster = Boolean(pocEmail && participantEmails.includes(pocEmail));
  const pending = pendingFrom(registration);
  const additions = Array.isArray(pending?.participantAdditions) ? pending.participantAdditions as AdminRow[] : [];
  const removals = Array.isArray(pending?.participantRemovals) ? pending.participantRemovals as AdminRow[] : [];
  const pendingCount = countPendingRegistrationChanges(pending);
  const fieldCount = pendingCount - additions.length - removals.length;
  const blocked = blockedSafetyRecipients(registration);
  const canAddPoc = Boolean(onAddPrimaryContact && pocEmail && !pocOnRoster && missing > 0);
  const rosterTone = rosterStatusFromCounts(expected, actual);
  const participantDelivery = participantEmails.length
    ? `${plural(participantEmails.length, "participant")} eligible for calendar invites and session reminders.`
    : "No participant recipients are saved yet.";
  const pocDelivery = pocEmail
    ? `POC summaries, invoices, and admin follow-ups go to ${pocEmail}.`
    : "POC delivery is unavailable until an email is saved.";

  return (
    <section className="registration-delivery-preflight" aria-label="Roster and delivery preflight">
      <div className="registration-section-heading">
        <div>
          <h3>Roster & Delivery Preflight</h3>
          <p>Check who is saved, who will receive participant delivery, and what needs attention before Apply.</p>
        </div>
        <StatusChip value={reconciliation.blocksCompletion ? reconciliation.status : rosterTone} />
      </div>

      <div className="registration-preflight-grid">
        <div className={`registration-preflight-tile${rosterTone === "COMPLETE" ? " is-success" : " is-warning"}`}>
          <span>Roster count</span>
          <strong>{actual}/{expected || actual || 0}</strong>
          <p>{missing > 0 ? `${plural(missing, "seat")} still needs participant details.` : "Saved roster matches stored expected seats; financial verification is separate."}</p>
        </div>
        <div className={`registration-preflight-tile${pocOnRoster ? " is-success" : pocEmail ? " is-warning" : " is-error"}`}>
          <span>POC in roster</span>
          <strong>{pocOnRoster ? "Yes" : "No"}</strong>
          <p>{pocOnRoster ? "The POC also receives participant delivery." : pocEmail ? "POC emails are admin-facing unless added as a participant." : "Add a POC email before sending admin follow-ups."}</p>
          {canAddPoc ? <Button size="small" variant="outlined" onClick={onAddPrimaryContact}>Add POC to roster</Button> : null}
        </div>
        <div className="registration-preflight-tile">
          <span>Participant delivery</span>
          <strong>{participantEmails.length ? "Saved recipients only" : "Needs roster"}</strong>
          <p>{participantDelivery}</p>
        </div>
        <div className={`registration-preflight-tile${blocked.length ? " is-error" : " is-success"}`}>
          <span>Safety mode</span>
          <strong>{blocked.length ? "Blocked recipient" : "No current block"}</strong>
          <p>{blocked.length ? `${blocked.join(", ")} was blocked by outbound safety mode.` : "No safety-mode block is recorded on this registration."}</p>
        </div>
      </div>

      <FinancialRosterReconciliation key={registration.id} registration={{...registration,id:registration.id}} onReviewed={onFinancialReview} />

      <div className="registration-preflight-notes">
        <div>
          <strong>POC delivery</strong>
          <span>{pocDelivery}</span>
        </div>
        <div>
          <strong>Pending Apply</strong>
          <span>
            {pendingCount > 0
              ? `${[additions.length ? plural(additions.length, "participant addition") : "", removals.length ? plural(removals.length, "participant removal") : "", fieldCount ? plural(fieldCount, "registration field change") : ""].filter(Boolean).join(", ")} waiting for Apply. Review the change summary above before sending updates.`
              : "No saved delivery changes are waiting for Apply."}
          </span>
        </div>
        {missing > 0 ? (
          <Typography color="text.secondary">
            Verify purchased seats and financial evidence before changing the stored expected count. Add participant details for missing team members; the POC is not automatically an attendee.
          </Typography>
        ) : null}
        {blocked.length ? (
          <Typography color="text.secondary">
            Add blocked test recipients in Settings &gt; Connected Tools, or enable live sending before applying POC-facing changes.
          </Typography>
        ) : null}
      </div>
    </section>
  );
}
