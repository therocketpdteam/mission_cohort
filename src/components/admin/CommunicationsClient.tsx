"use client";

import { EditOutlined } from "@/components/ui/icons";
import { PowerSettingsNewOutlined } from "@/components/ui/icons";
import { SendOutlined } from "@/components/ui/icons";
import { VisibilityOutlined } from "@/components/ui/icons";
import { Box, Button, Chip, Grid, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatStatusLabel } from "@/lib/formatting";
import { mergeFields, renderMergeFields, sampleMergeContext } from "@/modules/email/mergeFields";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  EmptyState,
  FieldConfig,
  MutationDialog,
  PageHeader,
  PageStack,
  RowActionMenu,
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
  { name: "type", label: "Type", type: "select", options: templateTypes.map((value) => ({ label: formatStatusLabel(value), value })) },
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
    { field: "type", headerName: "Type", width: 220, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "subject", headerName: "Subject", flex: 1.2, minWidth: 240 },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit template", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              { label: "Preview template", icon: <VisibilityOutlined fontSize="small" />, onClick: () => setPreviewTemplate(params.row) },
              { label: params.row.active ? "Deactivate template" : "Activate template", icon: <PowerSettingsNewOutlined fontSize="small" />, onClick: () => toggleTemplate(params.row) }
            ]}
          />
        </Box>
      )
    }
  ];

  const outboxColumns: GridColDef[] = [
    {
      field: "subject",
      headerName: "Message",
      flex: 1.35,
      minWidth: 260,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={800} noWrap>{params.row.subject}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {params.row.template?.name ?? "Custom"}
          </Typography>
        </Box>
      )
    },
    {
      field: "context",
      headerName: "Context",
      flex: 1,
      minWidth: 220,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap>{params.row.cohort?.title ?? cohorts.find((cohort) => cohort.id === params.row.cohortId)?.title ?? "-"}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{params.row.session?.title ?? "All sessions"}</Typography>
        </Box>
      )
    },
    { field: "recipientScope", headerName: "Recipients", width: 132, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "status", headerName: "Status", width: 116, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "timing",
      headerName: "Timing",
      width: 182,
      renderCell: (params) => {
        const scheduled = params.row.scheduledFor ? new Date(params.row.scheduledFor).toLocaleDateString() : "No schedule";
        const sent = params.row.sentAt ? new Date(params.row.sentAt).toLocaleDateString() : "Not sent";
        return (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" noWrap>{scheduled}</Typography>
            <Typography variant="caption" color="text.secondary" display="block" noWrap>{sent}</Typography>
          </Box>
        );
      }
    },
    {
      field: "performance",
      headerName: "Performance",
      width: 178,
      renderCell: (params) => {
        const summary = params.row.emailSummary ?? {};
        return (
          <Typography variant="caption" noWrap>
            D {summary.deliveredCount ?? 0} · O {summary.openedCount ?? 0} · B {summary.bouncedCount ?? 0} · F {summary.failedCount ?? 0}
          </Typography>
        );
      }
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 112,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              {
                label: params.row.sentAt ? "Resend message" : "Send message",
                icon: <SendOutlined fontSize="small" />,
                onClick: () => sendCommunication(params.row, params.row.sentAt ? "resend" : "send")
              }
            ]}
          />
        </Box>
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
              <AppDataGrid
                rows={templates}
                columns={templateColumns}
                loading={loading}
                pageSizeOptions={[10, 25]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                onRowClick={(params) => setPreviewTemplate(params.row)}
              />
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
            <CompactFilterBar resultCount={communications.length}>
              <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => load(event.target.value)} sx={{ minWidth: 280 }}>
                {cohorts.map((cohort) => (
                  <MenuItem value={cohort.id} key={cohort.id}>
                    {cohort.title}
                  </MenuItem>
                ))}
              </TextField>
            </CompactFilterBar>
            <TableShell>
              <AppDataGrid rows={communications} columns={outboxColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
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
