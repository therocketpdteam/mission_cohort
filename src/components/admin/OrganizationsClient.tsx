"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, Stack, TextField } from "@mui/material";
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
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const orgFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  { name: "type", label: "Type", type: "select", options: ["DISTRICT", "SCHOOL", "COMPANY", "PARTNER", "OTHER"].map((value) => ({ label: value, value })) },
  { name: "website", label: "Website" },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "phone", label: "Phone" },
  { name: "notes", label: "Notes", type: "textarea" }
];

export function OrganizationsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [organizationRows, paymentRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/organizations"),
      adminApi<AdminRow[]>("/api/payments").catch(() => [])
    ]);
    setRows(organizationRows);
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
    () => rows.filter((row) => [row.name, row.type, row.city, row.state].join(" ").toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1.2, minWidth: 220 },
    { field: "type", headerName: "Type", width: 140 },
    { field: "cityState", headerName: "City/State", width: 160, valueGetter: (_value, row) => [row.city, row.state].filter(Boolean).join(", ") },
    { field: "registrations", headerName: "Registrations", width: 130, valueGetter: (_value, row) => row._count?.registrations ?? 0 },
    { field: "participants", headerName: "Participants", width: 130, valueGetter: (_value, row) => row._count?.participants ?? 0 },
    {
      field: "pendingPayments",
      headerName: "Pending payments",
      width: 150,
      valueGetter: (_value, row) =>
        payments.filter((payment) => payment.organizationId === row.id && ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status)).length
    },
    { field: "notes", headerName: "Notes", flex: 1, minWidth: 200 },
    {
      field: "actions",
      headerName: "Actions",
      width: 220,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button component={Link} href={`/organizations/${params.row.id}` as Route} variant="outlined" startIcon={<VisibilityOutlined />}>
            View
          </Button>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
        </Stack>
      )
    }
  ];

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/organizations", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Organization updated" : "Organization created");
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
        title="Organizations"
        description="Manage districts, schools, companies, partner organizations, and operational notes."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Organization</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </SectionCard>
      <SectionCard title="Organization Directory">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} loading={loading} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No organizations found" description="Add an organization or adjust the search." />}
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Organization" : "Add Organization"}
        open={dialogOpen}
        fields={orgFields}
        initialValues={editing ?? { type: "DISTRICT" }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
