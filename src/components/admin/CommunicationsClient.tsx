"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import SendOutlined from "@mui/icons-material/SendOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, Chip, Grid, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { mergeFields, renderMergeFields, sampleMergeContext } from "@/modules/email/mergeFields";
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

const templateTypes = [
  "REGISTRATION_CONFIRMATION",
  "WEEK_BEFORE_REMINDER",
  "DAY_BEFORE_REMINDER",
  "HOUR_BEFORE_REMINDER",
  "FOLLOW_UP",
  "PAYMENT_REMINDER",
  "CUSTOM"
];

const templateFields: FieldConfig[] = [
  { name: "name", label: "Template name", required: true },
  { name: "subject", label: "Subject", required: true },
  { name: "type", label: "Type", type: "select", options: templateTypes.map((value) => ({ label: value.replace(/_/g, " "), value })) },
  { name: "active", label: "Active", type: "checkbox" },
  { name: "bodyHtml", label: "Body HTML", type: "textarea", required: true },
  { name: "bodyText", label: "Body text", type: "textarea" }
];

export function CommunicationsClient() {
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load(nextCohortId?: string) {
    const [templateRows, cohortRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/communications/templates"),
      adminApi<AdminRow[]>("/api/cohorts")
    ]);
    setTemplates(templateRows);
    setCohorts(cohortRows);
    const cohortId = nextCohortId ?? selectedCohortId ?? cohortRows[0]?.id ?? "";
    setSelectedCohortId(cohortId);
    setCommunications(cohortId ? await adminApi<AdminRow[]>(`/api/communications?cohortId=${cohortId}`) : []);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError]);

  const preview = useMemo(() => {
    if (!previewTemplate) {
      return null;
    }

    return {
      subject: renderMergeFields(previewTemplate.subject ?? "", sampleMergeContext, true),
      html: renderMergeFields(previewTemplate.bodyHtml ?? "", sampleMergeContext, true),
      text: renderMergeFields(previewTemplate.bodyText ?? "", sampleMergeContext, true)
    };
  }, [previewTemplate]);

  const activeTemplates = templates.filter((template) => template.active).length;

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/communications/templates", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Template updated" : "Template created");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function toggleTemplate(template: AdminRow) {
    try {
      await adminApi("/api/communications/templates", { method: "PATCH", body: { id: template.id, active: !template.active } });
      notifySuccess(template.active ? "Template deactivated" : "Template activated");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendCommunication(communication: AdminRow, action: "send" | "resend") {
    try {
      await adminApi("/api/communications", { method: "PATCH", body: { id: communication.id, action } });
      notifySuccess(action === "resend" ? "Communication resent" : "Communication sent");
      await load(selectedCohortId);
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const templateColumns: GridColDef[] = [
    { field: "name", headerName: "Template", flex: 1, minWidth: 220 },
    { field: "type", headerName: "Type", width: 220, valueFormatter: (value) => String(value ?? "").replace(/_/g, " ") },
    { field: "subject", headerName: "Subject", flex: 1.2, minWidth: 240 },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 340,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" startIcon={<VisibilityOutlined />} onClick={() => setPreviewTemplate(params.row)}>
            Preview
          </Button>
          <Button variant="outlined" startIcon={<PowerSettingsNewOutlined />} onClick={() => toggleTemplate(params.row)}>
            {params.row.active ? "Deactivate" : "Activate"}
          </Button>
        </Stack>
      )
    }
  ];

  const outboxColumns: GridColDef[] = [
    { field: "subject", headerName: "Subject", flex: 1, minWidth: 220 },
    { field: "template", headerName: "Template", width: 190, valueGetter: (_value, row) => row.template?.name ?? "Custom" },
    { field: "session", headerName: "Session", width: 180, valueGetter: (_value, row) => row.session?.title ?? "" },
    { field: "recipientScope", headerName: "Recipients", width: 180, valueFormatter: (value) => String(value ?? "").replace(/_/g, " ") },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "scheduledFor", headerName: "Scheduled", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "sentAt", headerName: "Sent", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 190,
      sortable: false,
      renderCell: (params) => (
        <Button
          variant="outlined"
          startIcon={<SendOutlined />}
          onClick={() => sendCommunication(params.row, params.row.sentAt ? "resend" : "send")}
        >
          {params.row.sentAt ? "Resend" : "Send"}
        </Button>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Manage active email templates, previews, scheduled messages, and send/resend operations."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Create Email Template</ToolbarButton>}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <SectionCard title="Template Health">
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`${activeTemplates} active`} color="success" />
              <Chip label={`${templates.length - activeTemplates} inactive`} />
              <Chip label={`${communications.length} selected cohort messages`} color="primary" />
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <SectionCard title="Merge Fields">
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {mergeFields.map((field) => (
                <Chip key={field} label={`{{${field}}}`} size="small" />
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Email Templates">
            <TableShell>
              <DataGrid rows={templates} columns={templateColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
            {!loading && templates.length === 0 && <EmptyState title="No templates found" description="Create templates for registration confirmations, reminders, and follow-up." />}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Preview">
            {preview ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">Subject</Typography>
                <Typography>{preview.subject.output}</Typography>
                <Typography variant="body2" color="text.secondary">HTML</Typography>
                <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }} dangerouslySetInnerHTML={{ __html: preview.html.output }} />
                {[...preview.subject.warnings, ...preview.html.warnings, ...preview.text.warnings].map((warning) => (
                  <Typography key={warning} color="warning.main" variant="body2">{warning}</Typography>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">Select Preview on a template to render sample merge fields.</Typography>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Outbox / Scheduled Messages">
            <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => load(event.target.value)} sx={{ minWidth: 320, mb: 2 }}>
              {cohorts.map((cohort) => (
                <MenuItem value={cohort.id} key={cohort.id}>
                  {cohort.title}
                </MenuItem>
              ))}
            </TextField>
            <TableShell>
              <DataGrid rows={communications} columns={outboxColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
            {communications.length === 0 && <EmptyState title="No scheduled messages" description="Scheduled, sent, and draft cohort messages will appear here." />}
          </SectionCard>
        </Grid>
      </Grid>
      <MutationDialog
        title={editing ? "Edit Template" : "Create Template"}
        open={dialogOpen}
        fields={templateFields}
        initialValues={editing ?? { type: "CUSTOM", active: true }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
