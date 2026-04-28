"use client";

import DeleteOutline from "@mui/icons-material/DeleteOutline";
import DoneAllOutlined from "@mui/icons-material/DoneAllOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
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
} from "@mui/material";
import { DataGrid, GridColDef, GridRowParams } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import {
  AdminRow,
  EmptyState,
  PageHeader,
  PageStack,
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
              getOptionLabel={(option) => `${option.primaryContactName ?? "POC"} • ${option.cohort?.title ?? "Cohort"} • ${option.organization?.name ?? "Organization"}`}
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
              {participantStatuses.map((value) => <MenuItem value={value} key={value}>{value.replace(/_/g, " ")}</MenuItem>)}
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

function ParticipantDetailDialog({ participant, open, onClose }: { participant: AdminRow | null; open: boolean; onClose: () => void }) {
  const latestPayment = participant?.registration?.paymentRecords?.[0];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Participant Detail</DialogTitle>
      <DialogContent>
        {participant ? (
          <Grid container spacing={2}>
            {[
              ["Participant", `${participant.firstName} ${participant.lastName}`],
              ["Email", participant.email],
              ["Phone", participant.phone ?? "-"],
              ["Title", participant.title ?? "-"],
              ["Status", participant.status],
              ["Certificate", participant.certificateIssued ? "Issued" : "Not issued"],
              ["Cohort", participant.cohort?.title ?? "-"],
              ["Organization", participant.organization?.name ?? "-"],
              ["Registration POC", participant.registration?.primaryContactName ?? "-"],
              ["POC Email", participant.registration?.primaryContactEmail ?? "-"],
              ["Payment", participant.registration?.paymentStatus ?? latestPayment?.status ?? "-"],
              ["Amount", `$${Number(participant.registration?.totalAmount ?? latestPayment?.amount ?? 0).toLocaleString()}`]
            ].map(([label, value]) => (
              <Grid size={{ xs: 12, sm: 6 }} key={label}>
                <Typography variant="body2" color="text.secondary">{label}</Typography>
                <Typography>{value}</Typography>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Typography color="text.secondary">No participant selected.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ParticipantsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [detail, setDetail] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [certificateIssued, setCertificateIssued] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [registrationPoc, setRegistrationPoc] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [participantRows, registrationRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/participants"),
      adminApi<AdminRow[]>("/api/registrations")
    ]);
    setRows(participantRows);
    setRegistrations(registrationRows);
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

  async function patchParticipant(body: AdminRow, success: string) {
    try {
      await adminApi("/api/participants", { method: "PATCH", body });
      notifySuccess(success);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => `${row.firstName} ${row.lastName}` },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "cohort", headerName: "Cohort", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "" },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => row.organization?.name ?? "" },
    { field: "registrationPoc", headerName: "Registration POC", width: 180, valueGetter: (_value, row) => row.registration?.primaryContactName ?? "" },
    { field: "title", headerName: "Title", width: 170 },
    { field: "phone", headerName: "Phone", width: 150 },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "certificateIssued", headerName: "Certificate", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "createdAt", headerName: "Created", width: 130, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 260,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1} onClick={(event) => event.stopPropagation()}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" color="success" startIcon={<DoneAllOutlined />} onClick={() => patchParticipant({ id: params.row.id, status: "COMPLETED" }, "Participant completed")}>
            Complete
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteOutline />}
            onClick={async () => {
              try {
                await adminApi(`/api/participants?id=${params.row.id}`, { method: "DELETE" });
                notifySuccess("Participant removed");
                await load();
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            Remove
          </Button>
        </Stack>
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
      <SectionCard title="Filters">
        <Stack direction={{ xs: "column", md: "row" }} flexWrap="wrap" gap={2}>
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All statuses</MenuItem>
            {participantStatuses.map((value) => <MenuItem value={value} key={value}>{value.replace(/_/g, " ")}</MenuItem>)}
          </TextField>
          <TextField select label="Certificate" value={certificateIssued} onChange={(event) => setCertificateIssued(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All certificates</MenuItem>
            <MenuItem value="true">Issued</MenuItem>
            <MenuItem value="false">Not issued</MenuItem>
          </TextField>
          <TextField select label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All cohorts</MenuItem>
            {cohortOptions.map(([id, label]) => <MenuItem value={id} key={id}>{label}</MenuItem>)}
          </TextField>
          <TextField select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All organizations</MenuItem>
            {organizationOptions.map(([id, label]) => <MenuItem value={id} key={id}>{label}</MenuItem>)}
          </TextField>
          <TextField select label="Registration POC" value={registrationPoc} onChange={(event) => setRegistrationPoc(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All POCs</MenuItem>
            {pocOptions.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
          </TextField>
        </Stack>
      </SectionCard>
      <SectionCard title="Participant Roster">
        <TableShell>
          <DataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            disableRowSelectionOnClick
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
      <ParticipantDetailDialog participant={detail} open={Boolean(detail)} onClose={() => setDetail(null)} />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
