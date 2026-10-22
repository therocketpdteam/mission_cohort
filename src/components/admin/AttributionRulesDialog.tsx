"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from "@/components/ui/primitives";
import { adminApi } from "@/lib/adminApi";
import { attributionOwners, type AttributionRule } from "@/lib/registrationAttribution";
export function AttributionRulesDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [config, setConfig] = useState<{ revision: string | null; rules: AttributionRule[] } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const reload = () => { setConfig(null); setError(""); adminApi<NonNullable<typeof config>>("/api/reports/attribution-rules").then(setConfig).catch((cause) => setError(cause.message)); };
  useEffect(() => { if (open) reload(); }, [open]);
  function update(id: string, field: string, value: string) { setConfig((old) => old ? { ...old, rules: old.rules.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule) } : old); }
  async function save() {
    if (!config) return;
    if (config.rules.some((rule) => !rule.source.trim() && !rule.campaign.trim())) { setError("Each rule needs a source or campaign."); return; }
    setSaving(true); setError("");
    try { setConfig(await adminApi("/api/reports/attribution-rules", { method: "PATCH", body: config })); onSaved(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save attribution rules."); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg"><DialogTitle>Marketing attribution rules</DialogTitle><DialogContent><p>Match captured source, medium, and campaign tags to the team that owns the outreach. Matches are exact and ignore capitalization. Blank fields match any value. Use a source or a campaign in every rule.</p><p>A generic tag such as “email” or a Jotform submission does not identify the sender. Conflicting owners stay unassigned. These rules apply to reports across all cohorts and can reclassify historical reports.</p>
    {error && <Alert severity="error">{error} <Button size="small" onClick={reload} disabled={saving}>Reload rules</Button></Alert>}
    {!config && !error && <p>Loading rules…</p>}
    {config && <div className="attribution-rule-list">{config.rules.map((rule, index) => <div className="attribution-rule-row" key={rule.id}><TextField label={`Rule ${index + 1} source`} value={rule.source} disabled={saving} onChange={(event) => update(rule.id, "source", event.target.value)} /><TextField label={`Rule ${index + 1} medium`} value={rule.medium} disabled={saving} onChange={(event) => update(rule.id, "medium", event.target.value)} /><TextField label={`Rule ${index + 1} campaign`} value={rule.campaign} disabled={saving} onChange={(event) => update(rule.id, "campaign", event.target.value)} /><TextField select label={`Rule ${index + 1} credit`} value={rule.owner} disabled={saving} onChange={(event) => update(rule.id, "owner", event.target.value)}>{Object.entries(attributionOwners).filter(([owner]) => owner !== "UNASSIGNED").map(([owner, label]) => <MenuItem key={owner} value={owner}>{label}</MenuItem>)}</TextField><Button color="error" variant="text" disabled={saving} onClick={() => setConfig({ ...config, rules: config.rules.filter((row) => row.id !== rule.id) })}>Remove</Button></div>)}<Button variant="outlined" disabled={saving || config.rules.length >= 100} onClick={() => setConfig({ ...config, rules: [...config.rules, { id: crypto.randomUUID(), source: "", medium: "", campaign: "", owner: "ROCKET_PD" }] })}>Add rule</Button></div>}
    <p>For future marketing links, include utm_source, utm_medium, and utm_campaign. The registration form must pass these fields or the tagged landing-page URL to Mission Cohort. Reports cannot recreate tags that were never captured.</p>
  </DialogContent><DialogActions><Button variant="outlined" onClick={onClose} disabled={saving}>Close</Button><Button onClick={() => void save()} disabled={!config || saving}>{saving ? "Saving…" : "Save attribution rules"}</Button></DialogActions></Dialog>;
}
