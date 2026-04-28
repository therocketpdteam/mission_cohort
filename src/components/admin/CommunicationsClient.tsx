"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import SendOutlined from "@mui/icons-material/SendOutlined";
import { Box, Button, Chip, Grid, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { mergeFields, renderMergeFields, sampleMergeContext } from "@/modules/email/mergeFields";
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
  { name: "type", label: "Type", type: "select", options: templateTypes.map((value) => ({ label: value, value })) },
  { name: "active", label: "Active", type: "checkbox" },
  { name: "bodyHtml", label: "Body HTML", type: "textarea", required: true },
  { name: "bodyText", label: "Body text", type: "textarea" }
];

export function CommunicationsClient() {
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [templateRows, cohortRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/communications/templates"),
      adminApi<AdminRow[]>("/api/cohorts")
    ]);
    setTemplates(templateRows);
    setCohorts(cohortRows);
    const cohortId = selectedCohortId || cohortRows[0]?.id || "";
    setSelectedCohortId(cohortId);
    if (cohortId) {
      setCommunications(await adminApi<AdminRow[]>(`/api/communications?cohortId=${cohortId}`));
    }
  }

  useEffect(() => {
    load().catch((error) => notifyError(error.message));
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

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
    { field: "subject", headerName: "Subject", flex: 1.2, minWidth: 240 },
    { field: "type", headerName: "Type", width: 220 },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 260,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" startIcon={<SendOutlined />} onClick={() => setPreviewTemplate(params.row)}>
            Preview
          </Button>
        </Stack>
      )
    }
  ];

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
    }
  }

  async function loadCommunications(cohortId: string) {
    setSelectedCohortId(cohortId);
    setCommunications(cohortId ? await adminApi<AdminRow[]>(`/api/communications?cohortId=${cohortId}`) : []);
  }

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Manage templates, merge fields, previews, and scheduled cohort communication records."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Create Email Template</ToolbarButton>}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Communication Templates">
            <TableShell>
              <DataGrid rows={templates} columns={columns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Merge Fields">
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {mergeFields.map((field) => (
                <Chip key={field} label={`{{${field}}}`} size="small" />
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
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
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Scheduled/Sent Messages">
            <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => loadCommunications(event.target.value)} sx={{ minWidth: 320, mb: 2 }}>
              {cohorts.map((cohort) => (
                <MenuItem value={cohort.id} key={cohort.id}>
                  {cohort.title}
                </MenuItem>
              ))}
            </TextField>
            <List dense>
              {communications.map((communication) => (
                <ListItem key={communication.id} divider>
                  <ListItemText primary={communication.subject} secondary={communication.scheduledFor ? new Date(communication.scheduledFor).toLocaleString() : "Not scheduled"} />
                  <StatusChip value={communication.status} />
                </ListItem>
              ))}
            </List>
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
