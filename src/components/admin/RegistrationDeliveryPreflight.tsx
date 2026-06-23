"use client";

import { Button, Typography } from "@/components/ui/primitives";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
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

export function RegistrationDeliveryPreflight({
  registration,
  onAddPrimaryContact
}: {
  registration: AdminRow;
  onAddPrimaryContact?: () => Promise<void> | void;
}) {
  const expected = Number(registration.participantCount ?? 0);
  const participants = ((registration.participants ?? []) as AdminRow[]).filter((participant) => normalizeEmail(participant.email));
  const actual = participants.length || Number(registration._count?.participants ?? 0);
  const missing = Math.max(expected - actual, 0);
  const participantEmails = participants.map((participant) => normalizeEmail(participant.email));
  const pocEmail = normalizeEmail(registration.primaryContactEmail);
  const pocOnRoster = Boolean(pocEmail && participantEmails.includes(pocEmail));
  const pending = pendingFrom(registration);
  const additions = Array.isArray(pending?.participantAdditions) ? pending.participantAdditions as AdminRow[] : [];
  const removals = Array.isArray(pending?.participantRemovals) ? pending.participantRemovals as AdminRow[] : [];
  const blocked = blockedSafetyRecipients(registration);
  const canAddPoc = Boolean(onAddPrimaryContact && pocEmail && !pocOnRoster && missing > 0);
  const rosterTone = missing === 0 && actual > 0 ? "COMPLETE" : actual > 0 ? "PARTIAL" : "NEEDED";
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
        <StatusChip value={rosterTone} />
      </div>

      <div className="registration-preflight-grid">
        <div className={`registration-preflight-tile${missing === 0 && actual > 0 ? " is-success" : " is-warning"}`}>
          <span>Roster count</span>
          <strong>{actual}/{expected || actual || 0}</strong>
          <p>{missing > 0 ? `${plural(missing, "seat")} still needs participant details.` : "Saved roster matches expected seats."}</p>
        </div>
        <div className={`registration-preflight-tile${pocOnRoster ? " is-success" : pocEmail ? " is-warning" : " is-error"}`}>
          <span>POC in roster</span>
          <strong>{pocOnRoster ? "Yes" : "No"}</strong>
          <p>{pocOnRoster ? "The POC also receives participant delivery." : pocEmail ? "POC emails are admin-facing unless added as a participant." : "Add a POC email before sending admin follow-ups."}</p>
          {canAddPoc ? <Button size="small" variant="outlined" onClick={onAddPrimaryContact}>Add POC to roster</Button> : null}
        </div>
        <div className="registration-preflight-tile">
          <span>Participant delivery</span>
          <strong>{participantEmails.length ? "Ready" : "Needs roster"}</strong>
          <p>{participantDelivery}</p>
        </div>
        <div className={`registration-preflight-tile${blocked.length ? " is-error" : " is-success"}`}>
          <span>Safety mode</span>
          <strong>{blocked.length ? "Blocked recipient" : "No current block"}</strong>
          <p>{blocked.length ? `${blocked.join(", ")} was blocked by outbound safety mode.` : "No safety-mode block is recorded on this registration."}</p>
        </div>
      </div>

      <div className="registration-preflight-notes">
        <div>
          <strong>POC delivery</strong>
          <span>{pocDelivery}</span>
        </div>
        <div>
          <strong>Pending Apply</strong>
          <span>
            {additions.length || removals.length
              ? `${additions.length ? `${plural(additions.length, "addition")}` : ""}${additions.length && removals.length ? " and " : ""}${removals.length ? `${plural(removals.length, "removal")}` : ""} will be coordinated when applied.`
              : "No participant add/remove batch is waiting for Apply."}
          </span>
        </div>
        {missing > 0 ? (
          <Typography color="text.secondary">
            Tip: if this is truly a one-person registration, set expected seats to 1 or add the POC to the roster. If it is a team, paste the remaining names in the roster workbench.
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

