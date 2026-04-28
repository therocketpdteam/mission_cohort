"use client";

import ArchiveOutlined from "@mui/icons-material/ArchiveOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, MenuItem, Stack, TextField } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import type { Route } from "next";
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

const cohortFields = (presenters: AdminRow[]): FieldConfig[] => [
  { name: "title", label: "Cohort title", required: true },
  { name: "slug", label: "Slug", required: true },
  {
    name: "presenterId",
    label: "Presenter",
    type: "select",
    options: presenters.map((presenter) => ({
      label: `${presenter.firstName} ${presenter.lastName}`,
      value: presenter.id
    })),
    required: true
  },
  { name: "status", label: "Status", type: "select", options: ["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "ACTIVE"].map((value) => ({ label: value, value })) },
  { name: "startDate", label: "Start date", type: "datetime-local", required: true },
  { name: "endDate", label: "End date", type: "datetime-local", required: true },
  { name: "registrationOpenDate", label: "Registration opens", type: "datetime-local" },
  { name: "registrationCloseDate", label: "Registration closes", type: "datetime-local" },
  { name: "maxParticipants", label: "Max participants", type: "number" },
  { name: "pricePerParticipant", label: "Price per participant", type: "number" },
  { name: "cohortType", label: "Cohort type", type: "select", options: ["LIVE_VIRTUAL", "HYBRID", "IN_PERSON"].map((value) => ({ label: value, value })) },
  { name: "description", label: "Description", type: "textarea" }
];

export function CohortsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [presenters, setPresenters] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohorts, presenterRows, paymentRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/presenters"),
      adminApi<AdminRow[]>("/api/payments").catch(() => [])
    ]);
    setRows(cohorts);
    setPresenters(presenterRows);
    setPayments(paymentRows);
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
        const matchesSearch = [row.title, row.presenter?.firstName, row.presenter?.lastName]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesStatus = status ? row.status === status : true;
        const matchesPresenter = presenterId ? row.presenterId === presenterId : true;
        return matchesSearch && matchesStatus && matchesPresenter;
      }),
    [rows, search, status, presenterId]
  );

  const columns: GridColDef[] = [
    { field: "title", headerName: "Cohort title", flex: 1.4, minWidth: 220 },
    {
      field: "presenter",
      headerName: "Presenter",
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row) => `${row.presenter?.firstName ?? ""} ${row.presenter?.lastName ?? ""}`
    },
    { field: "status", headerName: "Status", width: 170, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "startDate", headerName: "Start date", width: 140, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    { field: "endDate", headerName: "End date", width: 140, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    { field: "registrations", headerName: "Registrations", width: 130, valueGetter: (_value, row) => row._count?.registrations ?? 0 },
    { field: "participants", headerName: "Participants", width: 130, valueGetter: (_value, row) => row._count?.participants ?? 0 },
    {
      field: "pendingPayments",
      headerName: "Pending payments",
      width: 150,
      valueGetter: (_value, row) =>
        payments.filter((payment) => payment.cohortId === row.id && ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status)).length
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 260,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button component={Link} href={`/cohorts/${params.row.id}` as Route} variant="outlined" startIcon={<VisibilityOutlined />}>
            View
          </Button>
          <Button
            variant="outlined"
            startIcon={<EditOutlined />}
            onClick={() => {
              setEditing(params.row);
              setDialogOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            color="warning"
            variant="outlined"
            startIcon={<ArchiveOutlined />}
            onClick={async () => {
              try {
                await adminApi(`/api/cohorts/${params.row.id}`, { method: "PATCH", body: { status: "ARCHIVED" } });
                notifySuccess("Cohort archived");
                await load();
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            Archive
          </Button>
        </Stack>
      )
    }
  ];

  async function save(values: AdminRow) {
    try {
      const payload = { ...values };
      const path = editing ? `/api/cohorts/${editing.id}` : "/api/cohorts";
      await adminApi(path, { method: editing ? "PATCH" : "POST", body: payload });
      notifySuccess(editing ? "Cohort updated" : "Cohort created");
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
        title="Cohorts"
        description="Manage cohort setup, registration windows, presenters, status, and operational actions."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Create Cohort</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All statuses</MenuItem>
            {["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"].map((value) => (
              <MenuItem value={value} key={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Presenter" value={presenterId} onChange={(event) => setPresenterId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All presenters</MenuItem>
            {presenters.map((presenter) => (
              <MenuItem value={presenter.id} key={presenter.id}>
                {presenter.firstName} {presenter.lastName}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Date range" placeholder="Prompt 3 advanced filter" disabled />
        </Stack>
      </SectionCard>
      <SectionCard title="Cohort Operations">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} loading={loading} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No cohorts found" description="Create a cohort or adjust the filters." />}
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Cohort" : "Create Cohort"}
        open={dialogOpen}
        fields={cohortFields(presenters)}
        initialValues={editing ?? { defaultTimezone: "America/New_York", cohortType: "LIVE_VIRTUAL", pricePerParticipant: 0 }}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
