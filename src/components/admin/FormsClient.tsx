"use client";

import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import { Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
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

function formFields(cohorts: AdminRow[]): FieldConfig[] {
  return [
    { name: "cohortId", label: "Cohort", type: "select", options: cohorts.map((cohort) => ({ label: cohort.title, value: cohort.id })), required: true },
    { name: "title", label: "Form title", required: true },
    { name: "slug", label: "Slug", required: true },
    { name: "active", label: "Form enabled", type: "checkbox" },
    { name: "webhookEnabled", label: "Webhook enabled", type: "checkbox" },
    { name: "organizationInfo", label: "Organization info fields", type: "checkbox" },
    { name: "primaryContact", label: "Primary contact fields", type: "checkbox" },
    { name: "billingInfo", label: "Billing info fields", type: "checkbox" },
    { name: "participants", label: "Participant fields", type: "checkbox" },
    { name: "paymentMethod", label: "Payment method field", type: "checkbox" },
    { name: "purchaseOrderNumber", label: "PO number field", type: "checkbox" },
    { name: "successMessage", label: "Success message", type: "textarea" }
  ];
}

export function FormsClient() {
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [forms, setForms] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function loadCohorts() {
    const cohortRows = await adminApi<AdminRow[]>("/api/cohorts");
    setCohorts(cohortRows);
    const firstId = selectedCohortId || cohortRows[0]?.id || "";
    setSelectedCohortId(firstId);
    if (firstId) {
      setForms(await adminApi<AdminRow[]>(`/api/registration-forms?cohortId=${firstId}`));
    }
  }

  async function loadForms(cohortId: string) {
    setSelectedCohortId(cohortId);
    setForms(cohortId ? await adminApi<AdminRow[]>(`/api/registration-forms?cohortId=${cohortId}`) : []);
  }

  useEffect(() => {
    loadCohorts().catch((error) => notifyError(error.message));
  }, [notifyError]);

  const publicBase = typeof window === "undefined" ? "" : window.location.origin;

  const columns: GridColDef[] = [
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "slug", headerName: "Slug", flex: 1, minWidth: 220 },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "webhookEnabled", headerName: "Webhook", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "webhookEndpoint", headerName: "Webhook endpoint", flex: 1, minWidth: 260, valueGetter: () => "/api/webhooks/registrations" },
    {
      field: "actions",
      headerName: "Actions",
      width: 270,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button
            variant="outlined"
            startIcon={<ContentCopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(`${publicBase}/forms/${params.row.slug}`);
              notifySuccess("Form URL copied");
            }}
          >
            Copy URL
          </Button>
        </Stack>
      )
    }
  ];

  const selectedCohort = useMemo(() => cohorts.find((cohort) => cohort.id === selectedCohortId), [cohorts, selectedCohortId]);

  async function save(values: AdminRow) {
    try {
      const formConfigJson = {
        fields: {
          organizationInfo: Boolean(values.organizationInfo),
          primaryContact: Boolean(values.primaryContact),
          billingInfo: Boolean(values.billingInfo),
          participants: Boolean(values.participants),
          paymentMethod: Boolean(values.paymentMethod),
          purchaseOrderNumber: Boolean(values.purchaseOrderNumber)
        }
      };
      if (editing) {
        await adminApi(`/api/registration-forms/${editing.slug}`, { method: "PATCH", body: { ...values, formConfigJson } });
      } else {
        await adminApi("/api/registration-forms", { method: "POST", body: { ...values, formConfigJson } });
      }
      notifySuccess(editing ? "Registration form updated" : "Registration form created");
      setEditing(null);
      await loadForms(values.cohortId ?? selectedCohortId);
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  return (
    <PageStack>
      <PageHeader
        title="Registration Forms"
        description="Configure internal registration forms, field groups, webhook behavior, and shareable placeholders."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Create Form</ToolbarButton>}
      />
      <SectionCard title="Cohort">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
          <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => loadForms(event.target.value)} sx={{ minWidth: 320 }}>
            {cohorts.map((cohort) => (
              <MenuItem value={cohort.id} key={cohort.id}>
                {cohort.title}
              </MenuItem>
            ))}
          </TextField>
          <Typography color="text.secondary">
            Webhook endpoint: <strong>/api/webhooks/registrations</strong>
          </Typography>
        </Stack>
      </SectionCard>
      <SectionCard title={`Forms${selectedCohort ? ` for ${selectedCohort.title}` : ""}`}>
        <TableShell>
          <DataGrid rows={forms} columns={columns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
      </SectionCard>
      <MutationDialog
        title={editing ? "Edit Registration Form" : "Create Registration Form"}
        open={dialogOpen}
        fields={formFields(cohorts)}
        initialValues={
          editing
            ? { ...editing, ...(editing.formConfigJson?.fields ?? {}) }
            : {
                cohortId: selectedCohortId,
                active: true,
                webhookEnabled: true,
                organizationInfo: true,
                primaryContact: true,
                billingInfo: true,
                participants: true,
                paymentMethod: true,
                purchaseOrderNumber: true
              }
        }
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
