"use client";

import CancelOutlined from "@mui/icons-material/CancelOutlined";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutline";
import EditOutlined from "@mui/icons-material/EditOutlined";
import { Box, Button, MenuItem, Stack, TextField } from "@mui/material";
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

const paymentMethods = ["CREDIT_CARD", "PURCHASE_ORDER", "INVOICE", "COMPED", "UNKNOWN"];
const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];

function registrationFields(cohorts: AdminRow[], organizations: AdminRow[]): FieldConfig[] {
  return [
    { name: "cohortId", label: "Cohort", type: "select", options: cohorts.map((cohort) => ({ label: cohort.title, value: cohort.id })), required: true },
    { name: "organizationId", label: "Organization", type: "select", options: organizations.map((org) => ({ label: org.name, value: org.id })), required: true },
    { name: "primaryContactName", label: "Primary contact", required: true },
    { name: "primaryContactEmail", label: "Primary contact email", type: "email", required: true },
    { name: "participantCount", label: "Participant count", type: "number" },
    { name: "paymentMethod", label: "Payment method", type: "select", options: paymentMethods.map((value) => ({ label: value, value })) },
    { name: "paymentStatus", label: "Payment status", type: "select", options: paymentStatuses.map((value) => ({ label: value, value })) },
    { name: "invoiceNumber", label: "Invoice number" },
    { name: "purchaseOrderNumber", label: "PO number" },
    { name: "totalAmount", label: "Total amount", type: "number" },
    { name: "notes", label: "Notes", type: "textarea" }
  ];
}

export function RegistrationsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [organizations, setOrganizations] = useState<AdminRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [registrationRows, cohortRows, organizationRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/registrations"),
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/organizations")
    ]);
    setRows(registrationRows);
    setCohorts(cohortRows);
    setOrganizations(organizationRows);
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
        const matchSearch = [row.primaryContactName, row.primaryContactEmail, row.cohort?.title, row.organization?.name]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchPayment = paymentStatus ? row.paymentStatus === paymentStatus : true;
        return matchSearch && matchPayment;
      }),
    [rows, search, paymentStatus]
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

  const columns: GridColDef[] = [
    { field: "cohort", headerName: "Cohort", flex: 1.2, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "" },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => row.organization?.name ?? "" },
    { field: "primaryContactName", headerName: "Primary contact", flex: 1, minWidth: 180 },
    { field: "participantCount", headerName: "Participants", width: 120 },
    { field: "paymentMethod", headerName: "Method", width: 140 },
    { field: "paymentStatus", headerName: "Payment", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "invoiceNumber", headerName: "Invoice", width: 140 },
    { field: "purchaseOrderNumber", headerName: "PO", width: 130 },
    { field: "totalAmount", headerName: "Amount", width: 120, valueFormatter: (value) => `$${Number(value ?? 0).toLocaleString()}` },
    {
      field: "actions",
      headerName: "Actions",
      width: 290,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" color="success" startIcon={<CheckCircleOutline />} onClick={() => mutate({ id: params.row.id, action: "confirm" }, "Registration confirmed")}>
            Confirm
          </Button>
          <Button variant="outlined" color="warning" startIcon={<CancelOutlined />} onClick={() => mutate({ id: params.row.id, action: "cancel" }, "Registration cancelled")}>
            Cancel
          </Button>
        </Stack>
      )
    }
  ];

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/registrations", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Registration updated" : "Registration created");
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
        title="Registrations"
        description="Track registration status, billing contacts, payment method, invoices, and purchase orders."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Registration</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <TextField select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All payment statuses</MenuItem>
            {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
          </TextField>
        </Stack>
      </SectionCard>
      <SectionCard title="Registration Management">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} loading={loading} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No registrations found" description="Create a registration or adjust the filters." />}
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Registration" : "Add Registration"}
        open={dialogOpen}
        fields={registrationFields(cohorts, organizations)}
        initialValues={editing ?? { paymentMethod: "UNKNOWN", paymentStatus: "PENDING", participantCount: 0, totalAmount: 0 }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
