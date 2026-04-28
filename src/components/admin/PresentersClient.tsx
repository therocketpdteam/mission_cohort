"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import PersonOffOutlined from "@mui/icons-material/PersonOffOutlined";
import { Box, Button, Stack, TextField } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import {
  AdminRow,
  EmptyState,
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

const presenterFields: FieldConfig[] = [
  { name: "firstName", label: "First name", required: true },
  { name: "lastName", label: "Last name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "organization", label: "Organization" },
  { name: "phone", label: "Phone" },
  { name: "bio", label: "Bio", type: "textarea" },
  { name: "notes", label: "Notes", type: "textarea" }
];

export function PresentersClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    setRows(await adminApi<AdminRow[]>("/api/presenters"));
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError]);

  const filteredRows = useMemo(
    () => rows.filter((row) => [row.firstName, row.lastName, row.email, row.organization].join(" ").toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => `${row.firstName} ${row.lastName}` },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200 },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "cohortCount", headerName: "Cohorts", width: 120, valueGetter: (_value, row) => row._count?.cohorts ?? 0 },
    {
      field: "actions",
      headerName: "Actions",
      width: 250,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<PersonOffOutlined />}
            onClick={async () => {
              try {
                await adminApi("/api/presenters", { method: "PATCH", body: { id: params.row.id, active: false } });
                notifySuccess("Presenter deactivated");
                await load();
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            Deactivate
          </Button>
        </Stack>
      )
    }
  ];

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/presenters", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Presenter updated" : "Presenter created");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  return (
    <PageStack>
      <PageHeader
        title="Presenters"
        description="Manage presenters and thought leaders attached to cohort delivery."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Create Presenter</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </SectionCard>
      <SectionCard title="Presenter Directory">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} loading={loading} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No presenters found" description="Create a presenter to attach to cohorts." />}
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Presenter" : "Create Presenter"}
        open={dialogOpen}
        fields={presenterFields}
        initialValues={editing ?? { active: true }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
