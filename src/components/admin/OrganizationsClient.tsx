"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Box, TextField } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  EmptyState,
  FieldConfig,
  MutationDialog,
  PageHeader,
  PageStack,
  RowActionMenu,
  SectionCard,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const orgFields: FieldConfig[] = [
  { name: "name", label: "Name", required: true },
  { name: "type", label: "Type", type: "select", options: ["DISTRICT", "SCHOOL", "COMPANY", "PARTNER", "OTHER"].map((value) => ({ label: formatStatusLabel(value), value })) },
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
    { field: "name", headerName: "Name", flex: 1.2, minWidth: 220, valueGetter: (_value, row) => formatProperDisplay(row.name ?? "") },
    { field: "type", headerName: "Type", width: 140, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
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
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "View organization", icon: <VisibilityOutlined fontSize="small" />, onClick: () => window.location.assign(`/organizations/${params.row.id}`) },
              { label: "Edit organization", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } }
            ]}
          />
        </Box>
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
          <AppDataGrid rows={filteredRows} columns={columns} loading={loading} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
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
