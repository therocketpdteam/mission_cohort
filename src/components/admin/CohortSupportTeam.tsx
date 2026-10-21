"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatDateTimeInZone } from "@/lib/timezones";
import { renderMergeFields } from "@/modules/email/mergeFields";
import { supportReminderTemplate, type SupportPerson, type SupportReminderKind } from "@/modules/email/supportReminders";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from "@/components/ui/primitives";
import { type AdminRow, SectionCard, StatusChip } from "./common";

type Team = { revision: string | null; members: SupportPerson[]; reminders: AdminRow[] };
type EditablePerson = { id?: string; name: string; email: string; localKey: string };
const comparable = (members: Array<{ id?: string; name: string; email: string }>) => JSON.stringify(members.map(({ id, name, email }) => ({ id, name, email })));

export function CohortSupportTeam({ cohort, sessions }: { cohort: AdminRow; sessions: AdminRow[] }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [people, setPeople] = useState<EditablePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [kind, setKind] = useState<SupportReminderKind>("24h");
  const [sessionId, setSessionId] = useState("");
  const [personIndex, setPersonIndex] = useState(0);
  const dirty = !!team && comparable(people) !== comparable(team.members);
  const endpoint = `/api/cohorts/${cohort.id}/support-team`;
  const scheduleVersion = sessions.map((session) => `${session.id}:${session.startTime}`).join("|");

  function accept(value: Team) {
    setTeam(value);
    setPeople(value.members.map((person) => ({ ...person, localKey: person.id })));
  }

  async function reload() {
    setLoading(true); setError(""); setNotice("");
    try { accept(await adminApi<Team>(endpoint)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load the support team."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let ignore = false;
    // Session edits refresh delivery dates without discarding unsaved team
    // edits or advancing the revision used to detect conflicting saves.
    if (team) void adminApi<Team>(endpoint).then((value) => {
      if (!ignore) setTeam((previous) => previous?.revision === value.revision ? { ...previous, reminders: value.reminders } : previous);
    }).catch(() => {
      if (!ignore) setError("The reminder schedule could not be refreshed. Reload the team to try again.");
    });
    return () => { ignore = true; };
  }, [endpoint, scheduleVersion, cohort.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!team) return;
    setSaving(true); setError(""); setNotice("");
    try {
      accept(await adminApi<Team>(endpoint, { method: "PATCH", body: { revision: team.revision, members: people.map(({ id, name, email }) => ({ id, name, email })) } }));
      setNotice("Support team saved. Future reminders have been updated. No email was sent now.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the support team."); }
    finally { setSaving(false); }
  }

  const selectedSession = sessions.find((session) => session.id === sessionId) ?? sessions[0];
  const selectedPerson = people[personIndex] ?? people[0];
  const context = {
    support: { name: selectedPerson?.name || "Support team member", email: selectedPerson?.email || "" },
    cohort: { ...cohort, presenterName: [cohort.presenter?.firstName, cohort.presenter?.lastName].filter(Boolean).join(" ") },
    session: { ...selectedSession, meetingUrl: selectedSession?.meetingUrl || "[Add the session’s Zoom link]" }
  };
  const template = supportReminderTemplate(kind);
  const pending = team?.reminders.filter((reminder) => ["DRAFT", "SCHEDULED"].includes(reminder.status)).length ?? 0;
  const issues = team?.reminders.filter((reminder) => reminder.status === "FAILED").length ?? 0;

  return (
    <SectionCard title="Support Team" action={<Button variant="outlined" onClick={() => setPreview(true)} disabled={!sessions.length}>Preview reminders</Button>}>
      <Stack spacing={2}>
        <p className="cohort-support-description">Assign the people supporting Zoom sessions. Each person receives a separate 24-hour and 60-minute reminder for every session. Support assignments do not create participant registrations or use seats.</p>
        {error && <Alert severity="error">{error} <Button size="small" onClick={() => void reload()} disabled={saving}>Reload team</Button></Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        {loading ? <p>Loading support team…</p> : team && (
          <form onSubmit={(event) => void save(event)} className="cohort-support-form">
            {!people.length && <p>{team.members.length ? "Save to remove all support assignments and stop pending reminders." : "No support people assigned. No support reminders will be sent."}</p>}
            {people.map((person, index) => (
              <div className="cohort-support-person" key={person.localKey}>
                <TextField label={`Support person ${index + 1} name`} required value={person.name} disabled={saving} onChange={(event) => setPeople((rows) => rows.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} />
                <TextField label={`Support person ${index + 1} email`} type="email" required value={person.email} disabled={saving} onChange={(event) => setPeople((rows) => rows.map((row, i) => i === index ? { ...row, email: event.target.value } : row))} />
                <Button type="button" variant="text" color="error" disabled={saving} onClick={() => setPeople((rows) => rows.filter((_, i) => i !== index))} aria-label={`Remove support person ${index + 1}`}>Remove</Button>
              </div>
            ))}
            <div className="action-group cohort-support-actions">
              <Button type="button" variant="outlined" disabled={saving || people.length >= 50} onClick={() => setPeople((rows) => [...rows, { localKey: crypto.randomUUID(), name: "", email: "" }])}>Add support person</Button>
              <Button type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save support team"}</Button>
              {dirty && <Button type="button" variant="text" disabled={saving} onClick={() => accept(team)}>Discard changes</Button>}
            </div>
            <p className="cohort-support-description">Changes take effect when saved. Removing a person stops their pending reminders. Only reminder times still ahead when an assignment is saved will be scheduled. Reminders send while the cohort is published.</p>
            {!!people.length && sessions.some((session) => new Date(session.startTime) > new Date() && !session.meetingUrl) && <Alert severity="warning">Add a Zoom / meeting link to each upcoming session so its support reminders can be delivered.</Alert>}
          </form>
        )}
        {!!team?.reminders.length && (
          <details className="cohort-support-schedule">
            <summary>Reminder schedule · {pending} pending{issues ? ` · ${issues} need review` : ""}</summary>
            {team.reminders.map((reminder) => (
              <div className="cohort-support-reminder" key={reminder.id}>
                <div><strong>{reminder.kind === "24h" ? "24-hour reminder" : "60-minute reminder"} · {sessions.find((session) => session.id === reminder.sessionId)?.title ?? "Removed session"}</strong><span>{Array.isArray(reminder.recipientEmails) ? reminder.recipientEmails.join(", ") : ""}</span><small>{reminder.scheduledFor ? formatDateTimeInZone(reminder.scheduledFor, cohort.defaultTimezone) : "Unscheduled"}</small>{reminder.providerError && <small>{reminder.providerError}</small>}</div>
                <StatusChip value={reminder.status} />
              </div>
            ))}
          </details>
        )}
      </Stack>
      <Dialog open={preview} onClose={() => setPreview(false)} fullWidth maxWidth="md">
        <DialogTitle>Support reminder preview</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <p>Preview only. This does not send an email.</p>
            <TextField select label="Reminder" value={kind} onChange={(event) => setKind(event.target.value as SupportReminderKind)}><MenuItem value="24h">24 hours before</MenuItem><MenuItem value="60m">60 minutes before</MenuItem></TextField>
            <TextField select label="Session" value={selectedSession?.id ?? ""} onChange={(event) => setSessionId(event.target.value)}>{sessions.map((session) => <MenuItem key={session.id} value={session.id}>{session.title}</MenuItem>)}</TextField>
            {people.length > 0 && <TextField select label="Support person" value={String(Math.min(personIndex, people.length - 1))} onChange={(event) => setPersonIndex(Number(event.target.value))}>{people.map((person, index) => <MenuItem key={person.localKey} value={String(index)}>{person.name || `Support person ${index + 1}`}</MenuItem>)}</TextField>}
            <strong>{renderMergeFields(template.subject, context).output}</strong>
            <div className="cohort-support-preview">{renderMergeFields(template.bodyText, context).output}</div>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setPreview(false)}>Close preview</Button></DialogActions>
      </Dialog>
    </SectionCard>
  );
}
