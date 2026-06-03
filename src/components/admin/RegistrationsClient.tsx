"use client";

import { AddIcon } from "@/components/ui/icons";
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
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
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

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
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

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Registration Detail</DialogTitle>
      <DialogContent>
        {registration ? (
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}
            <Grid container spacing={2}>
              {[
                ["POC", registration.primaryContactName],
                ["Email", registration.primaryContactEmail],
                ["Phone", registration.primaryContactPhone ?? "-"],
                ["Cohort", registration.cohort?.title ?? "-"],
                ["Organization", registration.organization?.name ?? "-"],
                ["Participants", `${registration.participants?.length ?? 0} of ${registration.participantCount ?? 0}`],
                ["Payment", registration.paymentStatus],
                ["Amount", money(registration.totalAmount)],
                ["Invoice", registration.invoiceNumber ?? "-"],
                ["PO", registration.purchaseOrderNumber ?? "-"],
                ["Docs", registration.supportingDocumentStatus],
                ["QB Invoice", registration.quickBooksInvoiceRef ?? "-"],
                ["QB Status", registration.quickBooksInvoiceStatus ?? "UNKNOWN"],
                ["QB Sync", registration.quickBooksSyncStatus ?? "NOT SYNCED"],
                ["Source", formatRegistrationSource(registration)],
                ["UTM Source", registration.utmSource ?? "-"],
                ["UTM Medium", registration.utmMedium ?? "-"],
                ["UTM Campaign", registration.utmCampaign ?? "-"],
                ["Landing Page", registration.landingPageUrl ?? "-"],
                ["Referrer", registration.referrerUrl ?? "-"]
              ].map(([label, value]) => (
                <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={label}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography>
                    {["POC", "Organization"].includes(label) ? formatProperDisplay(String(value ?? "")) : ["Payment", "Docs", "QB Status", "QB Sync", "Source"].includes(label) ? formatStatusLabel(String(value ?? "")) : value}
                  </Typography>
                </Grid>
              ))}
            </Grid>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
              <Button variant="outlined" onClick={syncQuickBooks}>Sync QuickBooks</Button>
              <Button variant="outlined" color="warning" onClick={voidQuickBooksInvoice}>Void QB Invoice</Button>
              {registration.quickBooksSyncError && <Typography color="error.main">{registration.quickBooksSyncError}</Typography>}
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="h3">Jotform Revision Timeline</Typography>
              {(registration.webhookEvents ?? []).length > 0 ? (
                <List dense>
                  {(registration.webhookEvents ?? []).map((event: AdminRow) => (
                    <ListItem key={event.id} divider>
                      <ListItemText
                        primary={`Revision ${event.revisionNumber ?? "-"} · ${formatStatusLabel(event.status)}`}
                        secondary={`${event.processedAt || event.createdAt ? new Date(event.processedAt ?? event.createdAt).toLocaleString() : ""}${revisionSummary(event) ? ` · ${revisionSummary(event)}` : ""}${event.errorMessage ? ` · ${event.errorMessage}` : ""}`}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <EmptyState title="No Jotform revisions yet" description="Jotform imports and resubmissions linked to this registration will appear here." />
              )}
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="h3">POC Communication History</Typography>
              {threadLoading ? (
                <Typography color="text.secondary">Loading communication history...</Typography>
              ) : thread.length > 0 ? (
                <List dense>
                  {thread.map((communication) => (
                    <ListItem key={communication.id} divider>
                      <ListItemText
                        primary={communication.subject ?? "Email event"}
                        secondary={`${communication.cohort?.title ?? "Mission Control"} · ${formatStatusLabel(communication.status)}${communication.emailSummary?.lastEmailEvent ? ` · ${formatStatusLabel(communication.emailSummary.lastEmailEvent)}` : ""}`}
                      />
                      <Typography variant="caption" color="text.secondary">{communication.sentAt || communication.createdAt ? new Date(communication.sentAt ?? communication.createdAt).toLocaleDateString() : ""}</Typography>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <EmptyState title="No POC emails yet" description="Manual and automatic outbound emails to this POC will appear here with delivery and open signals." />
              )}
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="h3">Team Participants</Typography>
              <List dense>
                {(registration.participants ?? []).map((row: AdminRow) => (
                  <ListItem
                    key={row.id}
                    divider
                    sx={{ alignItems: "center", gap: 1.5 }}
                  >
                    <ListItemText
                      primary={formatProperDisplay(`${row.firstName} ${row.lastName}`)}
                      secondary={`${row.email}${row.title ? ` • ${row.title}` : ""}`}
                      sx={{ minWidth: 0 }}
                    />
                    <Button size="small" variant="text" color="error" startIcon={<DeleteOutline />} onClick={() => removeParticipant(row.id)}>Remove</Button>
                  </ListItem>
                ))}
              </List>
              {(registration.participants ?? []).length === 0 && (
                <EmptyState title="No participant details yet" description="If Jotform only sent a participant count, add names and emails here when the roster arrives." />
              )}
            </Stack>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 2 }}>
                <TextField fullWidth label="First name" value={participant.firstName} onChange={(event) => setParticipant((current) => ({ ...current, firstName: event.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <TextField fullWidth label="Last name" value={participant.lastName} onChange={(event) => setParticipant((current) => ({ ...current, lastName: event.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <TextField fullWidth label="Email" type="email" value={participant.email} onChange={(event) => setParticipant((current) => ({ ...current, email: event.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <TextField fullWidth label="Title" value={participant.title} onChange={(event) => setParticipant((current) => ({ ...current, title: event.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <Button fullWidth sx={{ height: "100%" }} startIcon={<AddIcon />} onClick={addParticipant}>Add</Button>
              </Grid>
            </Grid>
          </Stack>
        ) : (
          <Typography color="text.secondary">Loading registration detail.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
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
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [registrationRows, cohortRows, organizationRows, templateRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/registrations"),
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
  }, [notifyError]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchSearch = [
          row.primaryContactName,
          row.primaryContactEmail,
          row.primaryContactPhone,
          row.cohort?.title,
          row.organization?.name,
          row.invoiceNumber,
          row.purchaseOrderNumber
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchPayment = paymentStatus ? row.paymentStatus === paymentStatus : true;
        const matchRoster = rosterStatus ? row.participantListStatus === rosterStatus : true;
        const sourceLabel = formatRegistrationSource(row);
        const matchSource = source ? sourceLabel === source : true;
        return matchSearch && matchPayment && matchRoster && matchSource;
      }),
    [rows, search, paymentStatus, rosterStatus, source]
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

  async function runBulkAction(action: "confirm" | "cancel" | "payment" | "roster" | "docs" | "send") {
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

  const columns: GridColDef[] = [
    {
      field: "primaryContactName",
      headerName: "POC",
      flex: 1.15,
      minWidth: 190,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={800} noWrap>{formatProperDisplay(params.row.primaryContactName)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{params.row.primaryContactEmail}</Typography>
        </Box>
      )
    },
    { field: "organization", headerName: "Organization", flex: 1.05, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "cohort", headerName: "Cohort", flex: 1, minWidth: 170, valueGetter: (_value, row) => row.cohort?.title ?? "" },
    {
      field: "roster",
      headerName: "Qty / Roster",
      width: 156,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={800} noWrap>{params.row.participantCount ?? 0} seats</Typography>
          <StatusChip value={params.row.participantListStatus} />
        </Stack>
      )
    },
    { field: "paymentStatus", headerName: "Payment", width: 112, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "invoicePo",
      headerName: "Invoice / PO",
      flex: 0.75,
      minWidth: 130,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" noWrap>{params.row.invoiceNumber || "No invoice"}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" noWrap>{params.row.purchaseOrderNumber || "No PO"}</Typography>
        </Box>
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
              { label: "Cancel registration", icon: <CancelOutlined fontSize="small" />, color: "warning", onClick: () => mutate({ id: params.row.id, action: "cancel" }, "Registration cancelled") }
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
      <CompactFilterBar resultCount={filteredRows.length}>
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <TextField select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All payment statuses</MenuItem>
          {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Roster" value={rosterStatus} onChange={(event) => setRosterStatus(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All rosters</MenuItem>
          {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Source" value={source} onChange={(event) => setSource(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All sources</MenuItem>
          {sourceOptions.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
        </TextField>
      </CompactFilterBar>
      <SectionCard title="Registration Management">
        {selectedIds.length > 0 && (
          <Stack direction={{ xs: "column", lg: "row" }} flexWrap="wrap" useFlexGap gap={1.5} alignItems={{ xs: "stretch", lg: "center" }} sx={{ mb: 2 }}>
            <StatusChip value={`${selectedIds.length} selected`} />
            <Button size="small" variant="outlined" color="success" onClick={() => runBulkAction("confirm")}>Confirm</Button>
            <Button size="small" variant="outlined" color="warning" onClick={() => runBulkAction("cancel")}>Cancel</Button>
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
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
