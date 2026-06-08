"use client";

import { DeleteOutline } from "@/components/ui/icons";
import { DoneAllOutlined } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import { SendOutlined } from "@/components/ui/icons";
import {
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
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  DateBadge,
  EmptyState,
  PageHeader,
  PageStack,
  QuickViewDrawer,
  RowActionMenu,
  SectionCard,
  StatusChip,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const participantStatuses = ["REGISTERED", "CANCELLED", "COMPLETED", "NO_SHOW"];

function ParticipantEditor({
  open,
  editing,
  registrations,
  onClose,
  onSaved
}: {
  open: boolean;
  editing: AdminRow | null;
  registrations: AdminRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [registration, setRegistration] = useState<AdminRow | null>(null);
  const [values, setValues] = useState<AdminRow>({ status: "REGISTERED", certificateIssued: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(editing ?? { status: "REGISTERED", certificateIssued: false });
      setRegistration(registrations.find((row) => row.id === editing?.registrationId) ?? editing?.registration ?? null);
      setError(null);
    }
  }, [editing, open, registrations]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function save() {
    if (!registration || !values.firstName || !values.lastName || !values.email) {
      setError("Registration, first name, last name, and email are required");
      return;
    }

    try {
      await adminApi("/api/participants", {
        method: editing ? "PATCH" : "POST",
        body: {
          ...values,
          id: editing?.id,
          registrationId: registration.id,
          cohortId: registration.cohortId,
          organizationId: registration.organizationId
        }
      });
      await onSaved();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{editing ? "Edit Participant" : "Add Participant"}</DialogTitle>
      <DialogContent>
        {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              options={registrations}
              value={registration}
              onChange={(_event, value) => setRegistration(value)}
              getOptionLabel={(option) => `${formatProperDisplay(option.primaryContactName ?? "POC")} • ${option.cohort?.title ?? "Cohort"} • ${formatProperDisplay(option.organization?.name ?? "Organization")}`}
              renderInput={(params) => <TextField {...params} label="Registration" required />}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="First name" value={values.firstName ?? ""} onChange={(event) => setValue("firstName", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Last name" value={values.lastName ?? ""} onChange={(event) => setValue("lastName", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Email" type="email" value={values.email ?? ""} onChange={(event) => setValue("email", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Phone" value={values.phone ?? ""} onChange={(event) => setValue("phone", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Title" value={values.title ?? ""} onChange={(event) => setValue("title", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth select label="Status" value={values.status ?? "REGISTERED"} onChange={(event) => setValue("status", event.target.value)}>
              {participantStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth select label="Certificate issued" value={String(Boolean(values.certificateIssued))} onChange={(event) => setValue("certificateIssued", event.target.value === "true")}>
              <MenuItem value="false">No</MenuItem>
              <MenuItem value="true">Yes</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Certificate URL" value={values.certificateUrl ?? ""} onChange={(event) => setValue("certificateUrl", event.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function ParticipantDetailDialog({
  participant,
  open,
  templates,
  participantHistory,
  onClose,
  onSent,
  onError
}: {
  participant: AdminRow | null;
  open: boolean;
  templates: AdminRow[];
  participantHistory: AdminRow[];
  onClose: () => void;
  onSent: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const latestPayment = participant?.registration?.paymentRecords?.[0];
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setTemplateId("");
    }
  }, [open]);

  async function sendTemplate() {
    if (!participant || !templateId) {
      return;
    }

    setSending(true);
    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToParticipant", participantId: participant.id, templateId }
      });
      await onSent();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  const name = participant ? formatProperDisplay(`${participant.firstName} ${participant.lastName}`) : "Participant detail";

  return (
    <QuickViewDrawer
      open={open}
      onClose={onClose}
      title={name || "Participant detail"}
      actions={
        participant ? (
          <>
            <TextField
              select
              label="Template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              {templates.filter((template) => template.active).map((template) => (
                <MenuItem value={template.id} key={template.id}>{template.name}</MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" startIcon={<SendOutlined />} disabled={!templateId || sending} onClick={sendTemplate}>
              {sending ? "Sending" : "Send message"}
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : null
      }
    >
      {participant ? (
        <div className="participant-detail">
          <section className="participant-hero">
            <div>
              <span>{formatProperDisplay(participant.organization?.name ?? "Participant")}</span>
              <h3>{name}</h3>
              <p title={participant.cohort?.title ?? ""}>{participant.cohort?.title ?? "No cohort assigned"}</p>
            </div>
            <div className="participant-hero-status">
              <StatusChip value={participant.status} />
              <StatusChip value={participant.certificateIssued ? "Certificate issued" : "Certificate needed"} />
            </div>
          </section>

          <div className="quick-view-grid">
            <ParticipantTile label="Email" value={participant.email} />
            <ParticipantTile label="Phone" value={participant.phone ?? "-"} />
            <ParticipantTile label="Title" value={participant.title ?? "-"} />
            <ParticipantTile label="Registration POC" value={formatProperDisplay(participant.registration?.primaryContactName ?? "-")} />
            <ParticipantTile label="POC email" value={participant.registration?.primaryContactEmail ?? "-"} />
            <ParticipantTile label="Payment" value={formatStatusLabel(participant.registration?.paymentStatus ?? latestPayment?.status ?? "-")} />
            <ParticipantTile label="Amount" value={`$${Number(participant.registration?.totalAmount ?? latestPayment?.amount ?? 0).toLocaleString()}`} />
            <ParticipantTile label="Last email" value={participant.emailSummary?.lastEmailEvent ? `${formatStatusLabel(participant.emailSummary.lastEmailEvent)} · ${participant.emailSummary.lastEmailEventAt ? new Date(participant.emailSummary.lastEmailEventAt).toLocaleDateString() : ""}` : "-"} />
          </div>

          <section className="participant-detail-section">
            <div className="participant-section-heading">
              <div>
                <h3>Participation History</h3>
                <p>Other cohort appearances matched by participant email.</p>
              </div>
            </div>
            {participantHistory.length > 0 ? (
              <div className="quick-view-list">
                {participantHistory.map((row) => (
                  <div className="quick-view-list-row" key={row.id}>
                    <div>
                      <strong>{row.cohort?.title ?? "Cohort"}</strong>
                      <span>{formatProperDisplay(row.organization?.name ?? "Organization")} · {formatStatusLabel(row.status)}</span>
                    </div>
                    <DateBadge value={row.createdAt} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No other cohort history" description="This participant email has not appeared in another cohort yet." />
            )}
          </section>

          <section className="participant-detail-section">
            <div className="participant-section-heading">
              <div>
                <h3>Communication Context</h3>
                <p>Jump to Communications filtered to this participant.</p>
              </div>
              {participant.email ? (
                <Button href={`/communications?search=${encodeURIComponent(participant.email)}`} variant="outlined" size="small">
                  Open in Communications
                </Button>
              ) : null}
            </div>
            <div className="quick-view-grid">
              <ParticipantTile label="Sent" value={participant.emailSummary?.sentCount ?? 0} />
              <ParticipantTile label="Opened" value={participant.emailSummary?.openedCount ?? 0} />
              <ParticipantTile label="Clicked" value={participant.emailSummary?.clickedCount ?? 0} />
              <ParticipantTile label="Issues" value={participant.emailSummary?.unreviewedIssueCount ?? 0} />
            </div>
          </section>
        </div>
      ) : (
        <Typography color="text.secondary">No participant selected.</Typography>
      )}
    </QuickViewDrawer>
  );
}

function ParticipantTile({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="participant-detail-tile">
      <span>{label}</span>
      <strong title={String(value ?? "-")}>{value == null || value === "" ? "-" : String(value)}</strong>
    </div>
  );
}

export function ParticipantsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [detail, setDetail] = useState<AdminRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCertificate, setBulkCertificate] = useState("");
  const [bulkTemplateId, setBulkTemplateId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [certificateIssued, setCertificateIssued] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [registrationPoc, setRegistrationPoc] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [participantRows, registrationRows, templateRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/participants"),
      adminApi<AdminRow[]>("/api/registrations"),
      adminApi<AdminRow[]>("/api/communications/templates")
    ]);
    setRows(participantRows);
    setRegistrations(registrationRows);
    setTemplates(templateRows);
    setLoading(false);
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
          row.firstName,
          row.lastName,
          row.email,
          row.phone,
          row.title,
          row.organization?.name,
          row.cohort?.title,
          row.registration?.primaryContactName
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchStatus = status ? row.status === status : true;
        const matchCertificate = certificateIssued ? String(Boolean(row.certificateIssued)) === certificateIssued : true;
        const matchCohort = cohortId ? row.cohortId === cohortId : true;
        const matchOrganization = organizationId ? row.organizationId === organizationId : true;
        const matchPoc = registrationPoc ? row.registration?.primaryContactName === registrationPoc : true;
        return matchSearch && matchStatus && matchCertificate && matchCohort && matchOrganization && matchPoc;
      }),
    [rows, search, status, certificateIssued, cohortId, organizationId, registrationPoc]
  );

  const cohortOptions = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.cohortId, row.cohort?.title ?? row.cohortId])).entries()),
    [rows]
  );
  const organizationOptions = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.organizationId, row.organization?.name ?? row.organizationId])).entries()),
    [rows]
  );
  const pocOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.registration?.primaryContactName).filter(Boolean))) as string[],
    [rows]
  );
  const rowSelectionModel = useMemo<GridRowSelectionModel>(
    () => ({ type: "include", ids: new Set(selectedIds) }),
    [selectedIds]
  );
  const participantHistory = useMemo(() => {
    if (!detail?.email) {
      return [];
    }

    const email = String(detail.email).toLowerCase();
    return rows.filter((row) => String(row.email ?? "").toLowerCase() === email && row.id !== detail.id);
  }, [detail, rows]);

  async function patchParticipant(body: AdminRow, success: string) {
    try {
      await adminApi("/api/participants", { method: "PATCH", body });
      notifySuccess(success);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function runBulkAction(action: "status" | "certificate" | "send") {
    if (selectedIds.length === 0) {
      return;
    }

    try {
      if (action === "status") {
        if (!bulkStatus) {
          notifyError("Choose a participant status first");
          return;
        }

        await Promise.all(selectedIds.map((id) => adminApi("/api/participants", { method: "PATCH", body: { id, status: bulkStatus } })));
        notifySuccess("Participant statuses updated");
      }

      if (action === "certificate") {
        if (!bulkCertificate) {
          notifyError("Choose a certificate value first");
          return;
        }

        await Promise.all(selectedIds.map((id) => adminApi("/api/participants", { method: "PATCH", body: { id, certificateIssued: bulkCertificate === "true" } })));
        notifySuccess("Certificate status updated");
      }

      if (action === "send") {
        if (!bulkTemplateId) {
          notifyError("Choose an email template first");
          return;
        }

        await Promise.all(selectedIds.map((participantId) => adminApi("/api/communications", {
          method: "PATCH",
          body: { action: "sendTemplateToParticipant", participantId, templateId: bulkTemplateId }
        })));
        notifySuccess("Participant messages sent");
      }

      setSelectedIds([]);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const columns: GridColDef[] = [
    {
      field: "participant",
      headerName: "Participant",
      flex: 1.35,
      minWidth: 250,
      renderCell: (params) => {
        const name = formatProperDisplay(`${params.row.firstName} ${params.row.lastName}`);
        const helper = [params.row.email, params.row.title].filter(Boolean).join(" · ");
        return (
          <div className="app-table-identity">
            <span className="app-table-main" title={name}>{name}</span>
            <span className="app-table-sub" title={helper}>{helper || "No contact details"}</span>
          </div>
        );
      }
    },
    {
      field: "context",
      headerName: "Organization / Cohort",
      flex: 1.25,
      minWidth: 240,
      renderCell: (params) => {
        const organization = formatProperDisplay(params.row.organization?.name ?? "");
        const cohort = params.row.cohort?.title ?? "";
        return (
          <div className="app-table-context">
            <span className="app-table-main" title={organization}>{organization || "-"}</span>
            <span className="app-table-sub" title={cohort}>{cohort || "No cohort"}</span>
          </div>
        );
      }
    },
    {
      field: "registrationPoc",
      headerName: "POC",
      flex: 0.9,
      minWidth: 190,
      renderCell: (params) => {
        const poc = formatProperDisplay(params.row.registration?.primaryContactName ?? "");
        const email = params.row.registration?.primaryContactEmail ?? "";
        return (
          <div className="app-table-context">
            <span className="app-table-main" title={poc}>{poc || "-"}</span>
            <span className="app-table-sub" title={email}>{email || "No POC email"}</span>
          </div>
        );
      }
    },
    {
      field: "emailStatus",
      headerName: "Message",
      width: 132,
      valueGetter: (_value, row) => row.emailSummary?.lastEmailEvent ?? "",
      renderCell: (params) => {
        const sentAt = params.row.emailSummary?.lastEmailEventAt ? new Date(params.row.emailSummary.lastEmailEventAt).toLocaleDateString() : "";
        return (
          <div className="app-table-status-stack">
            {params.value ? <StatusChip value={params.value} /> : <Typography color="text.secondary">-</Typography>}
            {sentAt ? <span className="app-table-sub" title={sentAt}>{sentAt}</span> : null}
          </div>
        );
      }
    },
    {
      field: "progress",
      headerName: "Progress",
      width: 138,
      renderCell: (params) => (
        <div className="app-table-status-stack">
          <StatusChip value={params.row.status} />
          <span className="app-table-sub">{params.row.certificateIssued ? "Certificate issued" : "No certificate"}</span>
        </div>
      )
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
              { label: "Edit participant", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              { label: "Mark complete", icon: <DoneAllOutlined fontSize="small" />, color: "success", onClick: () => patchParticipant({ id: params.row.id, status: "COMPLETED" }, "Participant completed") },
              {
                label: "Remove participant",
                icon: <DeleteOutline fontSize="small" />,
                color: "error",
                onClick: async () => {
                  try {
                    await adminApi(`/api/participants?id=${params.row.id}`, { method: "DELETE" });
                    notifySuccess("Participant removed");
                    await load();
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              }
            ]}
          />
        </Box>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader
        title="Participants"
        description="Global participant roster across all cohorts, registrations, and organizations."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Participant</ToolbarButton>}
      />
      <CompactFilterBar
        resultCount={filteredRows.length}
        advanced={
          <>
            <TextField select label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="">All cohorts</MenuItem>
              {cohortOptions.map(([id, label]) => <MenuItem value={id} key={id}>{label}</MenuItem>)}
            </TextField>
            <TextField select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="">All organizations</MenuItem>
              {organizationOptions.map(([id, label]) => <MenuItem value={id} key={id}>{formatProperDisplay(label)}</MenuItem>)}
            </TextField>
            <TextField select label="Registration POC" value={registrationPoc} onChange={(event) => setRegistrationPoc(event.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="">All POCs</MenuItem>
              {pocOptions.map((value) => <MenuItem value={value} key={value}>{formatProperDisplay(value)}</MenuItem>)}
            </TextField>
          </>
        }
      >
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All statuses</MenuItem>
          {participantStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Certificate" value={certificateIssued} onChange={(event) => setCertificateIssued(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All certificates</MenuItem>
          <MenuItem value="true">Issued</MenuItem>
          <MenuItem value="false">Not issued</MenuItem>
        </TextField>
      </CompactFilterBar>
      <SectionCard title="Participant Roster">
        {selectedIds.length > 0 && (
          <div className="participant-bulk-bar">
            <span>{selectedIds.length} selected</span>
            <TextField select size="small" label="Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              {participantStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("status")}>Apply Status</Button>
            <TextField select size="small" label="Certificate" value={bulkCertificate} onChange={(event) => setBulkCertificate(event.target.value)}>
              <MenuItem value="true">Issued</MenuItem>
              <MenuItem value="false">Not issued</MenuItem>
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("certificate")}>Apply Certificate</Button>
            <TextField select size="small" label="Template" value={bulkTemplateId} onChange={(event) => setBulkTemplateId(event.target.value)}>
              {templates.filter((template) => template.active).map((template) => <MenuItem value={template.id} key={template.id}>{template.name}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" startIcon={<SendOutlined />} onClick={() => runBulkAction("send")}>Send Message</Button>
          </div>
        )}
        <TableShell>
          <AppDataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            checkboxSelection
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            rowSelectionModel={rowSelectionModel}
            onRowSelectionModelChange={(model) => setSelectedIds(Array.from(model.ids).map(String))}
            onRowClick={(params: GridRowParams) => setDetail(params.row)}
          />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No participants found" description="Add participants or adjust roster filters." />}
      </SectionCard>
      <ParticipantEditor
        open={dialogOpen}
        editing={editing}
        registrations={registrations}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={async () => {
          notifySuccess(editing ? "Participant updated" : "Participant added");
          await load();
        }}
      />
      <ParticipantDetailDialog
        participant={detail}
        open={Boolean(detail)}
        templates={templates}
        participantHistory={participantHistory}
        onClose={() => setDetail(null)}
        onSent={async () => {
          notifySuccess("Participant communication sent");
          await load();
        }}
        onError={notifyError}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
