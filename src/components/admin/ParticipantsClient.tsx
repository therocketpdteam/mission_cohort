"use client";

import DeleteOutline from "@mui/icons-material/DeleteOutline";
import DoneAllOutlined from "@mui/icons-material/DoneAllOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import { Box, Button, MenuItem, Stack, TextField } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import {
  AdminRow,
  FieldConfig,
  MutationDialog,
  PageHeader,
  PageStack,
  SectionCard,
  StatusChip,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const participantStatuses = ["REGISTERED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const attendanceStatuses = ["UNKNOWN", "ATTENDED", "PARTIAL", "ABSENT"];

function participantFields(registrations: AdminRow[]): FieldConfig[] {
  return [
    {
      name: "registrationId",
      label: "Registration",
      type: "select",
      options: registrations.map((registration) => ({
        label: `${registration.primaryContactName} • ${registration.cohort?.title ?? "Cohort"}`,
        value: registration.id
      })),
      required: true
    },
    { name: "cohortId", label: "Cohort ID", required: true },
    { name: "organizationId", label: "Organization ID", required: true },
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "title", label: "Title" },
    { name: "phone", label: "Phone" },
    { name: "status", label: "Status", type: "select", options: participantStatuses.map((value) => ({ label: value, value })) },
    { name: "attendanceStatus", label: "Attendance", type: "select", options: attendanceStatuses.map((value) => ({ label: value, value })) }
  ];
}

export function ParticipantsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [attendance, setAttendance] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [participantRows, registrationRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/participants"),
      adminApi<AdminRow[]>("/api/registrations")
    ]);
    setRows(participantRows);
    setRegistrations(registrationRows);
  }

  useEffect(() => {
    load().catch((error) => notifyError(error.message));
  }, [notifyError]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchSearch = [row.firstName, row.lastName, row.email, row.organization?.name, row.cohort?.title]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchStatus = status ? row.status === status : true;
        const matchAttendance = attendance ? row.attendanceStatus === attendance : true;
        const matchCohort = cohortId ? row.cohortId === cohortId : true;
        const matchOrganization = organizationId ? row.organizationId === organizationId : true;
        return matchSearch && matchStatus && matchAttendance && matchCohort && matchOrganization;
      }),
    [rows, search, status, attendance, cohortId, organizationId]
  );

  const cohortOptions = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.cohortId, row.cohort?.title ?? row.cohortId])).entries()),
    [rows]
  );
  const organizationOptions = useMemo(
    () => Array.from(new Map(rows.map((row) => [row.organizationId, row.organization?.name ?? row.organizationId])).entries()),
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
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => row.organization?.name ?? "" },
    { field: "cohort", headerName: "Cohort", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "" },
    { field: "title", headerName: "Title", width: 170 },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "attendanceStatus", headerName: "Attendance", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "certificateIssued", headerName: "Certificate", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 330,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" color="success" startIcon={<DoneAllOutlined />} onClick={() => patchParticipant({ id: params.row.id, attendanceStatus: "ATTENDED" }, "Marked attended")}>
            Attended
          </Button>
          <Button variant="outlined" color="success" onClick={() => patchParticipant({ id: params.row.id, status: "COMPLETED" }, "Completed placeholder applied")}>
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

  async function save(values: AdminRow) {
    try {
      const selectedRegistration = registrations.find((registration) => registration.id === values.registrationId);
      const payload = {
        ...values,
        cohortId: values.cohortId || selectedRegistration?.cohortId,
        organizationId: values.organizationId || selectedRegistration?.organizationId
      };
      await adminApi("/api/participants", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...payload, id: editing.id } : payload
      });
      notifySuccess(editing ? "Participant updated" : "Participant added");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  return (
    <PageStack>
      <PageHeader
        title="Participants"
        description="Manage participant rosters, attendance, completion status, and certificate readiness."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Participant</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All statuses</MenuItem>
            {participantStatuses.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
          </TextField>
          <TextField select label="Attendance" value={attendance} onChange={(event) => setAttendance(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All attendance</MenuItem>
            {attendanceStatuses.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
          </TextField>
          <TextField select label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All cohorts</MenuItem>
            {cohortOptions.map(([id, label]) => <MenuItem value={id} key={id}>{label}</MenuItem>)}
          </TextField>
          <TextField select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All organizations</MenuItem>
            {organizationOptions.map(([id, label]) => <MenuItem value={id} key={id}>{label}</MenuItem>)}
          </TextField>
        </Stack>
      </SectionCard>
      <SectionCard title="Participant Roster">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Participant" : "Add Participant"}
        open={dialogOpen}
        fields={participantFields(registrations)}
        initialValues={editing ?? { status: "REGISTERED", attendanceStatus: "UNKNOWN" }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
