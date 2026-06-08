"use client";

import { AddIcon } from "@/components/ui/icons";
import { ArchiveOutlined } from "@/components/ui/icons";
import { CancelOutlined } from "@/components/ui/icons";
import { CheckCircleOutline } from "@/components/ui/icons";
import { DeleteOutline } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@/components/ui/primitives";
import { GridColDef, GridRowParams, GridRowSelectionModel } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatRegistrationSource, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  EmptyState,
  PageHeader,
  PageStack,
  QuickViewDrawer,
  RowActionMenu,
  SectionCard,
  SourcePill,
  StatusChip,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const paymentMethods = ["CREDIT_CARD", "PURCHASE_ORDER", "INVOICE", "COMPED", "UNKNOWN"];
const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];
const rosterStatuses = ["NOT_REQUESTED", "NEEDED", "PARTIAL", "COMPLETE"];
const documentStatuses = ["NOT_READY", "READY", "SENT", "FAILED"];
const visibilityOptions = [
  { value: "active", label: "Active registrations" },
  { value: "archived", label: "Archived registrations" },
  { value: "all", label: "All registrations" }
];

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function splitName(name?: string | null) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || parts[0] || ""
  };
}

function rosterHealth(registration: AdminRow) {
  const expected = Number(registration.participantCount ?? 0);
  const actual = Number(registration.participants?.length ?? registration._count?.participants ?? 0);
  const status = String(registration.participantListStatus ?? "");

  if (status === "COMPLETE" && (!expected || actual >= expected)) {
    return { tone: "success", label: "Roster complete", helper: `${actual}/${expected || actual} participants` };
  }

  if (actual > 0 && expected > 0 && actual < expected) {
    return { tone: "warning", label: "Roster partial", helper: `${actual}/${expected} participants` };
  }

  if (actual === 0 && expected <= 1) {
    return { tone: "warning", label: "Needs participant", helper: "Can use POC as participant" };
  }

  if (actual === 0) {
    return { tone: "error", label: "Roster missing", helper: `${expected || "Unknown"} expected` };
  }

  return { tone: "warning", label: formatStatusLabel(status || "NEEDED"), helper: `${actual}/${expected || actual} participants` };
}

function communicationIssueLabel(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  if (Number(summary.unreviewedIssueCount ?? 0) > 0) {
    return "Open issue";
  }
  if (Number(summary.reviewedIssueCount ?? 0) > 0) {
    return "Reviewed issue";
  }
  return null;
}

function emptyRegistration() {
  return {
    primaryContactName: "",
    primaryContactEmail: "",
    primaryContactPhone: "",
    participantCount: 0,
    paymentMethod: "UNKNOWN",
    paymentStatus: "PENDING",
    participantListStatus: "NEEDED",
    supportingDocumentStatus: "NOT_READY",
    totalAmount: 0
  };
}

function RegistrationEditor({
  open,
  editing,
  cohorts,
  organizations,
  onClose,
  onSaved
}: {
  open: boolean;
  editing: AdminRow | null;
  cohorts: AdminRow[];
  organizations: AdminRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>(emptyRegistration());
  const [cohort, setCohort] = useState<AdminRow | null>(null);
  const [organization, setOrganization] = useState<AdminRow | null>(null);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(editing ?? emptyRegistration());
      setCohort(cohorts.find((item) => item.id === editing?.cohortId) ?? editing?.cohort ?? null);
      setOrganization(organizations.find((item) => item.id === editing?.organizationId) ?? editing?.organization ?? null);
      setOrganizationSearch(editing?.organization?.name ?? "");
      setError(null);
    }
  }, [cohorts, editing, open, organizations]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function createOrganizationInline() {
    if (!organizationSearch.trim()) {
      setError("Organization name is required");
      return;
    }

    const created = await adminApi<AdminRow>("/api/organizations", {
      method: "POST",
      body: { name: organizationSearch.trim(), type: "DISTRICT" }
    });
    setOrganization(created);
  }

  async function save() {
    if (!cohort || !organization || !values.primaryContactName || !values.primaryContactEmail) {
      setError("Cohort, organization, primary contact name, and primary contact email are required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await adminApi("/api/registrations", {
        method: editing ? "PATCH" : "POST",
        body: {
          ...values,
          id: editing?.id,
          cohortId: cohort.id,
          organizationId: organization.id
        }
      });
      await onSaved();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{editing ? "Edit Registration" : "Add Registration"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              options={cohorts}
              value={cohort}
              onChange={(_event, value) => setCohort(value)}
              getOptionLabel={(option) => option.title ?? ""}
              renderInput={(params) => <TextField {...params} label="Cohort" required />}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Autocomplete
                sx={{ flex: 1 }}
                options={organizations}
                value={organization}
                inputValue={organizationSearch}
                onInputChange={(_event, value) => setOrganizationSearch(value)}
                onChange={(_event, value) => setOrganization(value)}
                getOptionLabel={(option) => option.name ?? ""}
                renderInput={(params) => <TextField {...params} label="Organization" required />}
              />
              {!organization && organizationSearch.trim() && (
                <Button startIcon={<AddIcon />} onClick={createOrganizationInline}>Create</Button>
              )}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact" value={values.primaryContactName ?? ""} onChange={(event) => setValue("primaryContactName", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact email" type="email" value={values.primaryContactEmail ?? ""} onChange={(event) => setValue("primaryContactEmail", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact phone" value={values.primaryContactPhone ?? ""} onChange={(event) => setValue("primaryContactPhone", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="Participant count" type="number" value={values.participantCount ?? 0} onChange={(event) => setValue("participantCount", Number(event.target.value))} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth select label="Roster status" value={values.participantListStatus ?? "NEEDED"} onChange={(event) => setValue("participantListStatus", event.target.value)}>
              {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth select label="Payment method" value={values.paymentMethod ?? "UNKNOWN"} onChange={(event) => setValue("paymentMethod", event.target.value)}>
              {paymentMethods.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth select label="Payment status" value={values.paymentStatus ?? "PENDING"} onChange={(event) => setValue("paymentStatus", event.target.value)}>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="Invoice number" value={values.invoiceNumber ?? ""} onChange={(event) => setValue("invoiceNumber", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="PO number" value={values.purchaseOrderNumber ?? ""} onChange={(event) => setValue("purchaseOrderNumber", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="Total amount" type="number" value={values.totalAmount ?? 0} onChange={(event) => setValue("totalAmount", Number(event.target.value))} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth select label="Docs status" value={values.supportingDocumentStatus ?? "NOT_READY"} onChange={(event) => setValue("supportingDocumentStatus", event.target.value)}>
              {documentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="W-9 URL" value={values.w9Url ?? ""} onChange={(event) => setValue("w9Url", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Invoice URL" value={values.invoiceUrl ?? ""} onChange={(event) => setValue("invoiceUrl", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="QuickBooks customer ref" value={values.quickBooksCustomerRef ?? ""} onChange={(event) => setValue("quickBooksCustomerRef", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="QuickBooks invoice ref" value={values.quickBooksInvoiceRef ?? ""} onChange={(event) => setValue("quickBooksInvoiceRef", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="QuickBooks realm ID" value={values.quickBooksRealmId ?? ""} onChange={(event) => setValue("quickBooksRealmId", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth multiline minRows={3} label="Notes" value={values.notes ?? ""} onChange={(event) => setValue("notes", event.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving" : "Save"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function RegistrationDetailDialog({
  registration,
  open,
  onClose,
  onChanged
}: {
  registration: AdminRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [participant, setParticipant] = useState({ firstName: "", lastName: "", email: "", title: "", phone: "" });
  const [thread, setThread] = useState<AdminRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setParticipant({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !registration?.primaryContactEmail) {
      setThread([]);
      return;
    }

    setThreadLoading(true);
    adminApi<AdminRow[]>(`/api/communications/thread?email=${encodeURIComponent(registration.primaryContactEmail)}`)
      .then(setThread)
      .catch((loadError) => setError((loadError as Error).message))
      .finally(() => setThreadLoading(false));
  }, [open, registration?.primaryContactEmail]);

  async function addParticipant() {
    if (!registration || !participant.firstName || !participant.lastName || !participant.email) {
      setError("Participant first name, last name, and email are required");
      return;
    }

    try {
      await adminApi("/api/participants", {
        method: "POST",
        body: {
          ...participant,
          registrationId: registration.id,
          cohortId: registration.cohortId,
          organizationId: registration.organizationId
        }
      });
      setParticipant({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      await onChanged();
    } catch (addError) {
      setError((addError as Error).message);
    }
  }

  async function removeParticipant(id: string) {
    try {
      await adminApi(`/api/participants?id=${id}`, { method: "DELETE" });
      await onChanged();
    } catch (removeError) {
      setError((removeError as Error).message);
    }
  }

  async function syncQuickBooks() {
    if (!registration?.quickBooksInvoiceRef) {
      setError("QuickBooks invoice reference is required");
      return;
    }

    try {
      await adminApi("/api/jobs/sync-quickbooks", {
        method: "POST",
        body: { invoiceId: registration.quickBooksInvoiceRef, realmId: registration.quickBooksRealmId }
      });
      await onChanged();
    } catch (syncError) {
      setError((syncError as Error).message);
    }
  }

  async function voidQuickBooksInvoice() {
    if (!registration) {
      return;
    }

    try {
      await adminApi("/api/integrations/quickbooks/void-invoice", {
        method: "POST",
        body: { registrationId: registration.id }
      });
      await onChanged();
    } catch (voidError) {
      setError((voidError as Error).message);
    }
  }

  function revisionSummary(event: AdminRow) {
    const summary = event.normalizedSummary && typeof event.normalizedSummary === "object" ? event.normalizedSummary : {};
    const amount = Number(summary.totalAmount ?? 0);
    const participantText = `${summary.parsedParticipantCount ?? 0}${summary.participantCount ? ` / ${summary.participantCount}` : ""} participants`;
    const paymentText = [formatStatusLabel(String(summary.paymentStatus ?? "")), amount ? money(amount) : ""].filter(Boolean).join(" · ");
    return [participantText, paymentText].filter(Boolean).join(" · ");
  }

  const health = registration ? rosterHealth(registration) : null;
  const participantTotal = registration?.participants?.length ?? 0;
  const canUsePocAsParticipant = Boolean(registration?.primaryContactEmail && participantTotal === 0 && Number(registration?.participantCount ?? 0) <= 1);

  async function addPocAsParticipant() {
    if (!registration?.primaryContactEmail) {
      setError("POC email is required");
      return;
    }

    const name = splitName(registration.primaryContactName);
    try {
      await adminApi("/api/participants", {
        method: "POST",
        body: {
          firstName: name.firstName || "Participant",
          lastName: name.lastName || "Participant",
          email: registration.primaryContactEmail,
          phone: registration.primaryContactPhone ?? "",
          registrationId: registration.id,
          cohortId: registration.cohortId,
          organizationId: registration.organizationId
        }
      });
      await adminApi("/api/registrations", {
        method: "PATCH",
        body: {
          id: registration.id,
          participantCount: Math.max(1, Number(registration.participantCount ?? 0)),
          participantListStatus: "COMPLETE"
        }
      });
      await onChanged();
    } catch (addError) {
      setError((addError as Error).message);
    }
  }

  return (
    <QuickViewDrawer
      open={open}
      onClose={onClose}
      title={registration ? formatProperDisplay(registration.primaryContactName) || "Registration detail" : "Registration detail"}
      actions={
        registration ? (
          <>
            <Button variant="outlined" onClick={syncQuickBooks}>Sync QuickBooks</Button>
            <Button variant="outlined" color="warning" onClick={voidQuickBooksInvoice}>Void QB Invoice</Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : null
      }
    >
      {registration ? (
        <div className="registration-detail">
          {error && <Alert severity="error">{error}</Alert>}
          <section className="registration-hero">
            <div>
              <span className="registration-kicker">{registration.organization?.name ? formatProperDisplay(registration.organization.name) : "Registration"}</span>
              <h3>{formatProperDisplay(registration.primaryContactName)}</h3>
              <p title={registration.cohort?.title ?? ""}>{registration.cohort?.title ?? "No cohort assigned"}</p>
            </div>
            <div className="registration-hero-status">
              <StatusChip value={registration.paymentStatus} />
              <StatusChip value={health?.label} />
            </div>
          </section>

          <div className="quick-view-grid">
            <DetailTile label="POC email" value={registration.primaryContactEmail} />
            <DetailTile label="POC phone" value={registration.primaryContactPhone ?? "-"} />
            <DetailTile label="Payment" value={`${formatStatusLabel(registration.paymentStatus)} · ${money(registration.totalAmount)}`} />
            <DetailTile label="Roster" value={health?.helper ?? "-"} tone={health?.tone} />
            <DetailTile label="Invoice" value={registration.invoiceNumber ?? "No invoice"} />
            <DetailTile label="PO" value={registration.purchaseOrderNumber ?? "No PO"} />
            <DetailTile label="Source" value={formatRegistrationSource(registration)} />
            <DetailTile label="Landing page" value={registration.landingPageUrl ?? "-"} />
          </div>

          {registration.quickBooksSyncError && <Alert severity="error">{registration.quickBooksSyncError}</Alert>}

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Team Roster</h3>
                <p>{health?.label} · {health?.helper}</p>
              </div>
              {canUsePocAsParticipant ? (
                <Button size="small" variant="outlined" onClick={addPocAsParticipant}>Use POC as participant</Button>
              ) : null}
            </div>
            {(registration.participants ?? []).length > 0 ? (
              <div className="quick-view-list">
                {(registration.participants ?? []).map((row: AdminRow) => (
                  <div className="quick-view-list-row" key={row.id}>
                    <div>
                      <strong>{formatProperDisplay(`${row.firstName} ${row.lastName}`)}</strong>
                      <span>{[row.email, row.title].filter(Boolean).join(" · ") || "No contact details"}</span>
                    </div>
                    <Button size="small" variant="text" color="error" startIcon={<DeleteOutline />} onClick={() => removeParticipant(row.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No participant details yet" description="For one-person registrations, use the POC as the participant. For teams, add roster names when they arrive." />
            )}
            <div className="registration-add-participant">
              <TextField label="First name" value={participant.firstName} onChange={(event) => setParticipant((current) => ({ ...current, firstName: event.target.value }))} />
              <TextField label="Last name" value={participant.lastName} onChange={(event) => setParticipant((current) => ({ ...current, lastName: event.target.value }))} />
              <TextField label="Email" type="email" value={participant.email} onChange={(event) => setParticipant((current) => ({ ...current, email: event.target.value }))} />
              <TextField label="Title" value={participant.title} onChange={(event) => setParticipant((current) => ({ ...current, title: event.target.value }))} />
              <Button startIcon={<AddIcon />} onClick={addParticipant}>Add</Button>
            </div>
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>POC Communication History</h3>
                <p>Outbound messages, attachments, and delivery signals.</p>
              </div>
              {registration.primaryContactEmail ? (
                <Button href={`/communications?search=${encodeURIComponent(registration.primaryContactEmail)}`} variant="outlined" size="small">
                  Open in Communications
                </Button>
              ) : null}
            </div>
            {threadLoading ? (
              <Typography color="text.secondary">Loading communication history...</Typography>
            ) : thread.length > 0 ? (
              <div className="quick-view-list">
                {thread.map((communication) => (
                  <div className="quick-view-list-row" key={communication.id}>
                    <div>
                      <strong title={communication.subject}>{communication.subject ?? "Email event"}</strong>
                      <span title={communication.cohort?.title ?? ""}>
                        {`${communication.cohort?.title ?? "Mission Control"} · ${formatStatusLabel(communication.status)}${communication.emailSummary?.lastEmailEvent ? ` · ${formatStatusLabel(communication.emailSummary.lastEmailEvent)}` : ""}${communicationIssueLabel(communication) ? ` · ${communicationIssueLabel(communication)}` : ""}${communication.attachments?.length ? ` · ${communication.attachments.length} attachment${communication.attachments.length === 1 ? "" : "s"}` : ""}`}
                      </span>
                    </div>
                    <span>{communication.sentAt || communication.createdAt ? new Date(communication.sentAt ?? communication.createdAt).toLocaleDateString() : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No POC emails yet" description="Manual and automatic outbound emails to this POC will appear here with delivery and open signals." />
            )}
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Jotform Revision Timeline</h3>
                <p>Imports and resubmissions linked to this registration.</p>
              </div>
            </div>
            {(registration.webhookEvents ?? []).length > 0 ? (
              <div className="quick-view-list">
                {(registration.webhookEvents ?? []).map((event: AdminRow) => (
                  <div className="quick-view-list-row" key={event.id}>
                    <div>
                      <strong>{`Revision ${event.revisionNumber ?? "-"} · ${formatStatusLabel(event.status)}`}</strong>
                      <span>{`${event.processedAt || event.createdAt ? new Date(event.processedAt ?? event.createdAt).toLocaleString() : ""}${revisionSummary(event) ? ` · ${revisionSummary(event)}` : ""}${event.errorMessage ? ` · ${event.errorMessage}` : ""}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No Jotform revisions yet" description="Jotform imports and resubmissions linked to this registration will appear here." />
            )}
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Finance And Source Context</h3>
                <p>Invoice, QuickBooks, and attribution details.</p>
              </div>
            </div>
            <div className="quick-view-grid">
              <DetailTile label="Docs" value={formatStatusLabel(registration.supportingDocumentStatus)} />
              <DetailTile label="QB invoice" value={registration.quickBooksInvoiceRef ?? "-"} />
              <DetailTile label="QB status" value={formatStatusLabel(registration.quickBooksInvoiceStatus ?? "UNKNOWN")} />
              <DetailTile label="QB sync" value={formatStatusLabel(registration.quickBooksSyncStatus ?? "NOT SYNCED")} />
              <DetailTile label="UTM source" value={registration.utmSource ?? "-"} />
              <DetailTile label="UTM medium" value={registration.utmMedium ?? "-"} />
              <DetailTile label="UTM campaign" value={registration.utmCampaign ?? "-"} />
              <DetailTile label="Referrer" value={registration.referrerUrl ?? "-"} />
            </div>
          </section>
        </div>
      ) : (
        <Typography color="text.secondary">Loading registration detail.</Typography>
      )}
    </QuickViewDrawer>
  );
}

function DetailTile({ label, value, tone }: { label: string; value?: unknown; tone?: string }) {
  return (
    <div className={`registration-detail-tile${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong title={String(value ?? "-")}>{value == null || value === "" ? "-" : String(value)}</strong>
    </div>
  );
}

export function RegistrationsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [organizations, setOrganizations] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPaymentStatus, setBulkPaymentStatus] = useState("");
  const [bulkRosterStatus, setBulkRosterStatus] = useState("");
  const [bulkDocumentStatus, setBulkDocumentStatus] = useState("");
  const [bulkTemplateId, setBulkTemplateId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [detail, setDetail] = useState<AdminRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [source, setSource] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [visibility, setVisibility] = useState("active");
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<{ action: "archive" | "restore" | "delete"; row: AdminRow } | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const includeArchived = visibility !== "active";
    const [registrationRows, cohortRows, organizationRows, templateRows] = await Promise.all([
      adminApi<AdminRow[]>(`/api/registrations${includeArchived ? "?includeArchived=1" : ""}`),
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/organizations"),
      adminApi<AdminRow[]>("/api/communications/templates").catch(() => [])
    ]);
    setRows(registrationRows);
    setCohorts(cohortRows);
    setOrganizations(organizationRows);
    setTemplates(templateRows);
    setLoading(false);
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(await adminApi<AdminRow>(`/api/registrations?id=${id}`));
  }

  async function reloadDetail() {
    if (detail?.id) {
      await load();
      setDetail(await adminApi<AdminRow>(`/api/registrations?id=${detail.id}`));
    }
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError, visibility]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchSearch = [
          row.primaryContactName,
          row.primaryContactEmail,
          row.primaryContactPhone,
          row.cohort?.title,
          row.cohort?.shortName,
          row.organization?.name,
          row.invoiceNumber,
          row.purchaseOrderNumber,
          row.externalSubmissionId
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchPayment = paymentStatus ? row.paymentStatus === paymentStatus : true;
        const matchRoster = rosterStatus ? row.participantListStatus === rosterStatus : true;
        const sourceLabel = formatRegistrationSource(row);
        const matchSource = source ? sourceLabel === source : true;
        const matchCohort = cohortId ? row.cohortId === cohortId : true;
        const matchOrganization = organizationId ? row.organizationId === organizationId : true;
        const matchVisibility = visibility === "archived"
          ? Boolean(row.archivedAt)
          : visibility === "active"
            ? !row.archivedAt
            : true;
        return matchSearch && matchPayment && matchRoster && matchSource && matchCohort && matchOrganization && matchVisibility;
      }),
    [rows, search, paymentStatus, rosterStatus, source, cohortId, organizationId, visibility]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => formatRegistrationSource(row)).filter((value) => value && value !== "-"))) as string[],
    [rows]
  );
  const rowSelectionModel = useMemo<GridRowSelectionModel>(
    () => ({ type: "include", ids: new Set(selectedIds) }),
    [selectedIds]
  );

  async function mutate(body: AdminRow, success: string) {
    try {
      await adminApi("/api/registrations", { method: "PATCH", body });
      notifySuccess(success);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function runBulkAction(action: "confirm" | "cancel" | "archive" | "restore" | "payment" | "roster" | "docs" | "send") {
    if (selectedIds.length === 0) {
      return;
    }

    try {
      if (action === "send") {
        if (!bulkTemplateId) {
          notifyError("Choose an email template first");
          return;
        }

        await adminApi("/api/communications", {
          method: "PATCH",
          body: { action: "sendTemplateToRegistrations", templateId: bulkTemplateId, registrationIds: selectedIds }
        });
        notifySuccess("Selected communication sent");
      } else {
        if (action === "payment" && !bulkPaymentStatus) {
          notifyError("Choose a payment status first");
          return;
        }

        if (action === "roster" && !bulkRosterStatus) {
          notifyError("Choose a roster status first");
          return;
        }

        if (action === "docs" && !bulkDocumentStatus) {
          notifyError("Choose a document status first");
          return;
        }

        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            action: "bulk",
            ids: selectedIds,
            ...(action === "confirm" ? { bulkAction: "confirm" } : {}),
            ...(action === "cancel" ? { bulkAction: "cancel" } : {}),
            ...(action === "archive" ? { bulkAction: "archive" } : {}),
            ...(action === "restore" ? { bulkAction: "restore" } : {}),
            ...(action === "payment" && bulkPaymentStatus ? { paymentStatus: bulkPaymentStatus } : {}),
            ...(action === "roster" && bulkRosterStatus ? { participantListStatus: bulkRosterStatus } : {}),
            ...(action === "docs" && bulkDocumentStatus ? { supportingDocumentStatus: bulkDocumentStatus } : {})
          }
        });
        notifySuccess("Bulk update complete");
      }

      setSelectedIds([]);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function runLifecycleAction() {
    if (!pendingLifecycleAction) {
      return;
    }

    const { action, row } = pendingLifecycleAction;

    try {
      if (action === "delete") {
        await adminApi(`/api/registrations?id=${encodeURIComponent(String(row.id))}`, { method: "DELETE" });
        notifySuccess("Registration permanently deleted");
      } else {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            id: row.id,
            action,
            ...(action === "archive" ? { reason: "Archived from registration list" } : {})
          }
        });
        notifySuccess(action === "archive" ? "Registration archived" : "Registration restored");
      }

      setPendingLifecycleAction(null);
      setSelectedIds((current) => current.filter((id) => id !== row.id));
      if (detail?.id === row.id && action === "delete") {
        setDetailOpen(false);
        setDetail(null);
      }
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const columns: GridColDef[] = [
    {
      field: "primaryContactName",
      headerName: "POC",
      flex: 1.2,
      minWidth: 210,
      renderCell: (params) => (
        <div className="app-table-identity">
          <span className="app-table-main" title={formatProperDisplay(params.row.primaryContactName)}>{formatProperDisplay(params.row.primaryContactName)}</span>
          <span className="app-table-sub" title={params.row.primaryContactEmail}>
            {params.row.archivedAt ? `Archived · ${params.row.primaryContactEmail}` : params.row.primaryContactEmail}
          </span>
        </div>
      )
    },
    {
      field: "context",
      headerName: "Organization / Cohort",
      flex: 1.35,
      minWidth: 250,
      renderCell: (params) => (
        <div className="app-table-context">
          <span className="app-table-main" title={formatProperDisplay(params.row.organization?.name ?? "")}>{formatProperDisplay(params.row.organization?.name ?? "") || "-"}</span>
          <span className="app-table-sub" title={params.row.cohort?.title ?? ""}>{params.row.cohort?.title ?? "No cohort"}</span>
        </div>
      )
    },
    {
      field: "roster",
      headerName: "Roster",
      width: 168,
      renderCell: (params) => {
        const health = rosterHealth(params.row);
        return (
          <div className="registration-roster-cell" title={`${health.label} · ${health.helper}`}>
            <span className={`registration-health-dot is-${health.tone}`} />
            <div>
              <strong>{health.label}</strong>
              <span>{health.helper}</span>
            </div>
          </div>
        );
      }
    },
    {
      field: "payment",
      headerName: "Payment",
      width: 152,
      renderCell: (params) => (
        <div className="app-table-status-stack">
          <StatusChip value={params.row.paymentStatus} />
          <span className="app-table-sub" title={money(params.row.totalAmount)}>{money(params.row.totalAmount)}</span>
        </div>
      )
    },
    {
      field: "source",
      headerName: "Source",
      width: 154,
      renderCell: (params) => <SourcePill row={params.row} />
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit registration", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              { label: "Confirm registration", icon: <CheckCircleOutline fontSize="small" />, color: "success", onClick: () => mutate({ id: params.row.id, action: "confirm" }, "Registration confirmed") },
              { label: "Cancel registration", icon: <CancelOutlined fontSize="small" />, color: "warning", onClick: () => mutate({ id: params.row.id, action: "cancel" }, "Registration cancelled") },
              params.row.archivedAt
                ? { label: "Restore registration", icon: <ArchiveOutlined fontSize="small" />, onClick: () => setPendingLifecycleAction({ action: "restore", row: params.row }) }
                : { label: "Archive registration", icon: <ArchiveOutlined fontSize="small" />, onClick: () => setPendingLifecycleAction({ action: "archive", row: params.row }) },
              { label: "Delete permanently", icon: <DeleteOutline fontSize="small" />, color: "error", onClick: () => setPendingLifecycleAction({ action: "delete", row: params.row }) }
            ]}
          />
        </Box>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader
        title="Registrations"
        description="The POC-first operations hub for team registrations, payment status, supporting documents, and participant rosters."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Registration</ToolbarButton>}
      />
      <CompactFilterBar
        resultCount={filteredRows.length}
        advanced={(
          <>
            <TextField select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <MenuItem value="">All organizations</MenuItem>
              {organizations.map((organization) => <MenuItem value={organization.id} key={organization.id}>{formatProperDisplay(organization.name)}</MenuItem>)}
            </TextField>
            <TextField select label="Source" value={source} onChange={(event) => setSource(event.target.value)}>
              <MenuItem value="">All sources</MenuItem>
              {sourceOptions.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
            </TextField>
            <TextField select label="Visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              {visibilityOptions.map((option) => <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>)}
            </TextField>
          </>
        )}
      >
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <TextField select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All payment statuses</MenuItem>
          {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Roster" value={rosterStatus} onChange={(event) => setRosterStatus(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All rosters</MenuItem>
          {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All cohorts</MenuItem>
          {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
        </TextField>
      </CompactFilterBar>
      <SectionCard title="Registration Management">
        {selectedIds.length > 0 && (
          <Stack direction={{ xs: "column", lg: "row" }} flexWrap="wrap" useFlexGap gap={1.5} alignItems={{ xs: "stretch", lg: "center" }} sx={{ mb: 2 }}>
            <StatusChip value={`${selectedIds.length} selected`} />
            <Button size="small" variant="outlined" color="success" onClick={() => runBulkAction("confirm")}>Confirm</Button>
            <Button size="small" variant="outlined" color="warning" onClick={() => runBulkAction("cancel")}>Cancel</Button>
            <Button size="small" variant="outlined" onClick={() => runBulkAction(visibility === "archived" ? "restore" : "archive")}>
              {visibility === "archived" ? "Restore" : "Archive"}
            </Button>
            <TextField select size="small" label="Payment" value={bulkPaymentStatus} onChange={(event) => setBulkPaymentStatus(event.target.value)} sx={{ minWidth: 170 }}>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("payment")}>Apply Payment</Button>
            <TextField select size="small" label="Roster" value={bulkRosterStatus} onChange={(event) => setBulkRosterStatus(event.target.value)} sx={{ minWidth: 170 }}>
              {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("roster")}>Apply Roster</Button>
            <TextField select size="small" label="Docs" value={bulkDocumentStatus} onChange={(event) => setBulkDocumentStatus(event.target.value)} sx={{ minWidth: 160 }}>
              {documentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("docs")}>Apply Docs</Button>
            <TextField select size="small" label="Template" value={bulkTemplateId} onChange={(event) => setBulkTemplateId(event.target.value)} sx={{ minWidth: 220 }}>
              {templates.filter((template) => template.active).map((template) => <MenuItem value={template.id} key={template.id}>{template.name}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("send")}>Send/Resend</Button>
          </Stack>
        )}
        <TableShell>
          <AppDataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            checkboxSelection
            rowHeight={64}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            disableRowSelectionOnClick
            rowSelectionModel={rowSelectionModel}
            onRowSelectionModelChange={(model) => setSelectedIds(Array.from(model.ids).map(String))}
            onRowClick={(params: GridRowParams) => openDetail(String(params.id))}
          />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No registrations found" description="Create a registration or adjust the filters." />}
      </SectionCard>
      <RegistrationEditor
        open={dialogOpen}
        editing={editing}
        cohorts={cohorts}
        organizations={organizations}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={async () => {
          notifySuccess(editing ? "Registration updated" : "Registration created");
          await load();
        }}
      />
      <RegistrationDetailDialog
        open={detailOpen}
        registration={detail}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        onChanged={reloadDetail}
      />
      <Dialog open={Boolean(pendingLifecycleAction)} onClose={() => setPendingLifecycleAction(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {pendingLifecycleAction?.action === "delete"
            ? "Delete registration permanently?"
            : pendingLifecycleAction?.action === "restore"
              ? "Restore registration?"
              : "Archive registration?"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography>
              {pendingLifecycleAction?.row
                ? `${formatProperDisplay(String(pendingLifecycleAction.row.primaryContactName ?? ""))} · ${pendingLifecycleAction.row.primaryContactEmail ?? ""}`
                : ""}
            </Typography>
            {pendingLifecycleAction?.action === "delete" ? (
              <Alert severity="warning">
                Permanent delete removes the registration, participants, payments, and registration tasks. Jotform history is kept for audit. Records with invoices or QuickBooks references are blocked and should be archived instead.
              </Alert>
            ) : pendingLifecycleAction?.action === "archive" ? (
              <Alert severity="info">
                Archive hides this registration from normal operational lists without deleting history or finance context.
              </Alert>
            ) : (
              <Alert severity="info">Restore brings this registration back into the normal operational lists.</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setPendingLifecycleAction(null)}>Cancel</Button>
          <Button color={pendingLifecycleAction?.action === "delete" ? "error" : "primary"} onClick={runLifecycleAction}>
            {pendingLifecycleAction?.action === "delete" ? "Delete permanently" : pendingLifecycleAction?.action === "restore" ? "Restore" : "Archive"}
          </Button>
        </DialogActions>
      </Dialog>
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
