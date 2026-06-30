"use client";

import { useMemo, useState } from "react";
import { Button, Stack, TextField, Typography } from "@/components/ui/primitives";
import { parseRosterText, type ParsedRosterParticipant } from "@/lib/rosterParser";
import { formatProperDisplay } from "@/lib/formatting";
import { AdminRow, EmptyState, StatusChip } from "./common";

type RosterWorkbenchProps = {
  registration: AdminRow;
  existingParticipants?: AdminRow[];
  onImport: (participants: ParsedRosterParticipant[]) => Promise<void>;
  onAddPrimaryContact?: () => Promise<void>;
  onRemoveParticipant?: (participantId: string) => Promise<void>;
  showSavedParticipants?: boolean;
};

export function RosterWorkbench({
  registration,
  existingParticipants = [],
  onImport,
  onAddPrimaryContact,
  onRemoveParticipant,
  showSavedParticipants = false
}: RosterWorkbenchProps) {
  const [rosterText, setRosterText] = useState("");
  const [importing, setImporting] = useState(false);
  const parsed = useMemo(() => parseRosterText(rosterText), [rosterText]);
  const existingEmails = useMemo(
    () => new Set(existingParticipants.map((participant) => String(participant.email ?? "").toLowerCase()).filter(Boolean)),
    [existingParticipants]
  );
  const newParticipants = parsed.participants.filter((participant) => !existingEmails.has(participant.email));
  const duplicateCount = parsed.participants.length - newParticipants.length;
  const expected = Number(registration.participantCount ?? 0);
  const projectedTotal = existingParticipants.length + newParticipants.length;
  const existingMissingTitleCount = existingParticipants.filter((participant) => !String(participant.title ?? "").trim()).length;
  const newMissingTitleCount = newParticipants.filter((participant) => !participant.title?.trim()).length;
  const projectedMissingTitleCount = existingMissingTitleCount + newMissingTitleCount;
  const savedComplete = expected > 0 && existingParticipants.length >= expected && existingMissingTitleCount === 0;
  const savedPartial = expected > 0 && existingParticipants.length > 0 && existingParticipants.length < expected;
  const primaryContactEmail = String(registration.primaryContactEmail ?? "").toLowerCase();
  const primaryContactMissing = Boolean(primaryContactEmail && !existingEmails.has(primaryContactEmail));
  const canAddPrimaryContact = Boolean(onAddPrimaryContact && primaryContactMissing && (expected === 0 || existingParticipants.length < expected));

  async function importRoster() {
    if (newParticipants.length === 0 || importing) {
      return;
    }

    setImporting(true);
    try {
      await onImport(newParticipants);
      setRosterText("");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="roster-workbench">
      <div className="registration-section-heading">
        <div>
          <h3>Roster Workbench</h3>
          <p>
            {savedComplete
              ? "Roster is complete. New valid rows can still be added if the team grows."
              : savedPartial || existingMissingTitleCount > 0
                ? "Roster is partial. Paste missing people or add participant titles when they arrive."
                : "Paste names, titles, and emails from a message, spreadsheet, or CSV."}
          </p>
        </div>
        <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} alignItems="center" justifyContent="flex-end">
          {canAddPrimaryContact ? <Button size="small" variant="outlined" onClick={onAddPrimaryContact}>Add POC to roster</Button> : null}
          <StatusChip value={projectedTotal >= expected && expected > 0 && projectedMissingTitleCount === 0 ? "COMPLETE" : projectedTotal > 0 ? "PARTIAL" : "NEEDED"} />
        </Stack>
      </div>
      {savedComplete && (
        <div className="roster-workbench-state is-complete">
          Roster complete at {existingParticipants.length}/{expected} participants. Related participant-list follow-ups close automatically.
        </div>
      )}
      {savedPartial && (
        <div className="roster-workbench-state is-partial">
          Roster partial at {existingParticipants.length}/{expected} participants. The participant-list follow-up stays open until the count is complete.
        </div>
      )}
      {existingMissingTitleCount > 0 && (
        <div className="roster-workbench-state is-partial">
          {existingMissingTitleCount} saved participant{existingMissingTitleCount === 1 ? "" : "s"} missing title. The participant-list follow-up stays open until titles are added.
        </div>
      )}
      {showSavedParticipants && existingParticipants.length > 0 ? (
        <div className="quick-view-list">
          {existingParticipants.map((participant) => (
            <div className="quick-view-list-row" key={participant.id}>
              <div>
                <strong>{formatProperDisplay(`${participant.firstName ?? ""} ${participant.lastName ?? ""}`)}</strong>
                <span>{[participant.email, participant.title || "Missing title"].filter(Boolean).join(" · ")}</span>
              </div>
              {onRemoveParticipant ? <Button size="small" variant="text" color="error" onClick={() => onRemoveParticipant(participant.id)}>Remove</Button> : null}
            </div>
          ))}
        </div>
      ) : null}
      <TextField
        label="Paste roster"
        multiline
        minRows={5}
        value={rosterText}
        onChange={(event) => setRosterText(event.target.value)}
        placeholder={"Ada Lovelace, Math Coach, ada@example.com\nGrace Hopper, Principal, grace@example.com"}
        helperText="Preferred: Full Name, Title, email. Also accepted: Full Name, email; tab-separated spreadsheet rows; or Full Name email@example.com."
      />
      <div className="roster-workbench-summary">
        <span>{existingParticipants.length} saved</span>
        <span>{newParticipants.length} ready to add</span>
        <span>{duplicateCount} already exists</span>
        <span>{newMissingTitleCount} missing title</span>
        <span>{parsed.errors.length} needs review</span>
      </div>
      {parsed.warnings.length > 0 && (
        <div className="roster-workbench-errors">
          {parsed.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
          {parsed.warnings.length > 4 && <span>{parsed.warnings.length - 4} more title warnings.</span>}
        </div>
      )}
      {parsed.errors.length > 0 && (
        <div className="roster-workbench-errors">
          {parsed.errors.slice(0, 4).map((error) => <span key={error}>{error}</span>)}
          {parsed.errors.length > 4 && <span>{parsed.errors.length - 4} more lines need review.</span>}
        </div>
      )}
      {newParticipants.length > 0 ? (
        <div className="quick-view-list">
          {newParticipants.slice(0, 6).map((participant) => (
            <div className="quick-view-list-row" key={participant.email}>
              <div>
                <strong>{formatProperDisplay(`${participant.firstName} ${participant.lastName}`)}</strong>
                <span>{[participant.email, participant.title, participant.phone].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
          ))}
          {newParticipants.length > 6 && (
            <Typography color="text.secondary">{newParticipants.length - 6} more participants ready to import.</Typography>
          )}
        </div>
      ) : rosterText.trim() ? (
        <EmptyState title="No new participants detected" description="Fix any line warnings or remove people already saved on this registration." />
      ) : null}
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} justifyContent="space-between" alignItems="center">
        <Typography color="text.secondary">
          {expected ? `${projectedTotal}/${expected} projected roster` : `${projectedTotal} projected participants`}
        </Typography>
        <Button size="small" onClick={importRoster} disabled={newParticipants.length === 0 || importing}>
          {importing ? "Adding" : newParticipants.length ? `Add ${newParticipants.length} to roster` : "Add to roster"}
        </Button>
      </Stack>
    </div>
  );
}
