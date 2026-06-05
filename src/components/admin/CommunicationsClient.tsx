"use client";

import { EditOutlined, EmailOutlined, PowerSettingsNewOutlined, SendOutlined, VisibilityOutlined } from "@/components/ui/icons";
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatStatusLabel } from "@/lib/formatting";
import { mergeFields, renderMergeFields, sampleMergeContext } from "@/modules/email/mergeFields";
import {
  ActionGroup,
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  EmptyState,
  FieldConfig,
  MutationDialog,
  PageHeader,
  PageStack,
  QuickViewDrawer,
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

const tabs = ["Outbox", "Issues", "Templates"] as const;

function communicationHasIssue(row: AdminRow) {
  const summary = row.emailSummary ?? {};
  const status = String(row.status ?? "").toLowerCase();
  return Number(summary.bouncedCount ?? 0) > 0 || Number(summary.failedCount ?? 0) > 0 || status.includes("fail") || status.includes("bounce");
}

function formatDate(value?: string | null, empty = "Not scheduled") {
  if (!value) {
    return empty;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : empty;
}

function DeliverySummary({ row }: { row: AdminRow }) {
  const summary = row.emailSummary ?? {};
  const delivered = Number(summary.deliveredCount ?? 0);
  const opened = Number(summary.openedCount ?? 0);
  const bounced = Number(summary.bouncedCount ?? 0);
  const failed = Number(summary.failedCount ?? 0);

  return (
    <div className="comms-delivery-strip" title={`Delivered ${delivered}, opened ${opened}, bounced ${bounced}, failed ${failed}`}>
      <span className="is-success">D {delivered}</span>
      <span>O {opened}</span>
      <span className={bounced ? "is-warning" : undefined}>B {bounced}</span>
      <span className={failed ? "is-error" : undefined}>F {failed}</span>
    </div>
  );
}

function CommunicationsStat({ label, value, helper, tone }: { label: string; value: number | string; helper: string; tone?: "success" | "warning" | "error" | "primary" }) {
  return (
    <div className={`comms-stat-card ${tone ? `is-${tone}` : ""}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </div>
  );
}

export function CommunicationsClient() {
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [messageSearch, setMessageSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mergeFieldsOpen, setMergeFieldsOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminRow | null>(null);
  const [messageDetail, setMessageDetail] = useState<AdminRow | null>(null);
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
    setCommunications(cohortId ? await adminApi<AdminRow[]>(`/api/communications?cohortId=${encodeURIComponent(cohortId)}`) : []);
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

  const selectedCohort = cohorts.find((cohort) => cohort.id === selectedCohortId);
  const activeTemplates = templates.filter((template) => template.active).length;
  const issueMessages = communications.filter(communicationHasIssue);
  const searchedMessages = communications.filter((row) =>
    [
      row.subject,
      row.template?.name,
      row.recipientScope,
      row.session?.title,
      row.status
    ]
      .join(" ")
      .toLowerCase()
      .includes(messageSearch.toLowerCase())
  );
  const searchedIssues = issueMessages.filter((row) =>
    [
      row.subject,
      row.template?.name,
      row.recipientScope,
      row.session?.title,
      row.status
    ]
      .join(" ")
      .toLowerCase()
      .includes(messageSearch.toLowerCase())
  );
  const scheduledMessages = communications.filter((row) => row.scheduledFor && !row.sentAt).length;
  const sentMessages = communications.filter((row) => row.sentAt).length;
  const deliveryTotals = communications.reduce(
    (total, row) => {
      const summary = row.emailSummary ?? {};
      total.delivered += Number(summary.deliveredCount ?? 0);
      total.opened += Number(summary.openedCount ?? 0);
      total.failed += Number(summary.failedCount ?? 0) + Number(summary.bouncedCount ?? 0);
      return total;
    },
    { delivered: 0, opened: 0, failed: 0 }
  );
  const openRate = deliveryTotals.delivered > 0 ? `${Math.round((deliveryTotals.opened / deliveryTotals.delivered) * 100)}%` : "0%";

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

  const outboxColumns: GridColDef[] = [
    {
      field: "subject",
      headerName: "Message",
      flex: 1.5,
      minWidth: 270,
      renderCell: (params) => (
        <div className="app-table-identity">
          <span className="app-table-main" title={params.row.subject}>{params.row.subject || "Untitled message"}</span>
          <span className="app-table-sub" title={params.row.template?.name ?? "Custom"}>{params.row.template?.name ?? "Custom"}</span>
        </div>
      )
    },
    {
      field: "audience",
      headerName: "Audience",
      flex: 1.1,
      minWidth: 210,
      renderCell: (params) => {
        const scope = formatStatusLabel(String(params.row.recipientScope ?? "Recipients"));
        const session = params.row.session?.title ?? "All sessions";
        return (
          <div className="app-table-context">
            <span className="app-table-main" title={scope}>{scope}</span>
            <span className="app-table-sub" title={session}>{session}</span>
          </div>
        );
      }
    },
    {
      field: "timing",
      headerName: "Timing",
      width: 138,
      renderCell: (params) => (
        <div className="app-table-context">
          <span className="app-table-main" title={formatDate(params.row.scheduledFor)}>{formatDate(params.row.scheduledFor)}</span>
          <span className="app-table-sub" title={formatDate(params.row.sentAt, "Not sent")}>{formatDate(params.row.sentAt, "Not sent")}</span>
        </div>
      )
    },
    { field: "delivery", headerName: "Delivery", width: 150, renderCell: (params) => <DeliverySummary row={params.row} /> },
    { field: "status", headerName: "Status", width: 116, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 92,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              {
                label: params.row.sentAt ? "Resend message" : "Send message",
                icon: <SendOutlined fontSize="small" />,
                onClick: () => sendCommunication(params.row, params.row.sentAt ? "resend" : "send")
              },
              { label: "View details", icon: <VisibilityOutlined fontSize="small" />, onClick: () => setMessageDetail(params.row) }
            ]}
          />
        </Box>
      )
    }
  ];

  const templateColumns: GridColDef[] = [
    {
      field: "name",
      headerName: "Template",
      flex: 1.25,
      minWidth: 240,
      renderCell: (params) => (
        <div className="app-table-identity">
          <span className="app-table-main" title={params.row.name}>{params.row.name}</span>
          <span className="app-table-sub" title={formatStatusLabel(String(params.row.type ?? ""))}>{formatStatusLabel(String(params.row.type ?? ""))}</span>
        </div>
      )
    },
    { field: "subject", headerName: "Subject", flex: 1.4, minWidth: 280 },
    { field: "active", headerName: "Active", width: 112, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 92,
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

  const visibleRows = activeTab === 1 ? searchedIssues : searchedMessages;

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Monitor scheduled messages, delivery health, templates, and send/resend operations."
        action={
          <ActionGroup>
            <Button variant="outlined" startIcon={<EmailOutlined />} onClick={() => setMergeFieldsOpen(true)}>Merge Fields</Button>
            <ToolbarButton onClick={() => setDialogOpen(true)}>Create Template</ToolbarButton>
          </ActionGroup>
        }
      />

      <div className="comms-summary-grid">
        <CommunicationsStat label="Scheduled" value={scheduledMessages} helper="Messages queued for this cohort" tone="primary" />
        <CommunicationsStat label="Sent" value={sentMessages} helper="Messages already delivered or attempted" tone="success" />
        <CommunicationsStat label="Issues" value={issueMessages.length} helper="Failed or bounced items to review" tone={issueMessages.length ? "error" : "success"} />
        <CommunicationsStat label="Open rate" value={openRate} helper={`${deliveryTotals.opened} opens from ${deliveryTotals.delivered} delivered`} tone="warning" />
        <CommunicationsStat label="Templates" value={`${activeTemplates}/${templates.length}`} helper="Active templates in library" />
      </div>

      <SectionCard
        title="Message Workspace"
        action={
          <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => load(event.target.value)} sx={{ width: 300 }}>
            {cohorts.map((cohort) => (
              <MenuItem value={cohort.id} key={cohort.id}>
                {cohort.title}
              </MenuItem>
            ))}
          </TextField>
        }
      >
        <div className="comms-workspace-head">
          <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)}>
            {tabs.map((label) => <Tab key={label} label={label} />)}
          </Tabs>
          <span title={selectedCohort?.title ?? ""}>{selectedCohort?.title ?? "No cohort selected"}</span>
        </div>

        {activeTab < 2 ? (
          <>
            <CompactFilterBar resultCount={visibleRows.length}>
              <TextField label="Search messages" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} />
            </CompactFilterBar>
            <TableShell>
              <AppDataGrid
                rows={visibleRows}
                columns={outboxColumns}
                loading={loading}
                pageSizeOptions={[10, 25]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                onRowClick={(params) => setMessageDetail(params.row)}
              />
            </TableShell>
            {!loading && visibleRows.length === 0 && (
              <EmptyState
                title={activeTab === 1 ? "No communication issues" : "No scheduled messages"}
                description={activeTab === 1 ? "Failed and bounced messages for this cohort will appear here." : "Scheduled, sent, and draft cohort messages will appear here."}
              />
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </SectionCard>

      <QuickViewDrawer
        title={messageDetail?.subject ?? "Message detail"}
        open={Boolean(messageDetail)}
        onClose={() => setMessageDetail(null)}
        actions={messageDetail ? (
          <Button
            startIcon={<SendOutlined />}
            onClick={() => sendCommunication(messageDetail, messageDetail.sentAt ? "resend" : "send")}
          >
            {messageDetail.sentAt ? "Resend" : "Send"}
          </Button>
        ) : null}
      >
        {messageDetail ? (
          <div className="comms-detail-grid">
            <div>
              <span>Template</span>
              <strong>{messageDetail.template?.name ?? "Custom"}</strong>
            </div>
            <div>
              <span>Audience</span>
              <strong>{formatStatusLabel(String(messageDetail.recipientScope ?? "-"))}</strong>
            </div>
            <div>
              <span>Scheduled</span>
              <strong>{formatDate(messageDetail.scheduledFor)}</strong>
            </div>
            <div>
              <span>Sent</span>
              <strong>{formatDate(messageDetail.sentAt, "Not sent")}</strong>
            </div>
            <div>
              <span>Status</span>
              <StatusChip value={messageDetail.status} />
            </div>
            <div>
              <span>Delivery</span>
              <DeliverySummary row={messageDetail} />
            </div>
          </div>
        ) : null}
      </QuickViewDrawer>

      <QuickViewDrawer
        title={previewTemplate?.name ?? "Template preview"}
        open={Boolean(previewTemplate)}
        onClose={() => setPreviewTemplate(null)}
        actions={previewTemplate ? (
          <Button
            variant="outlined"
            startIcon={<EditOutlined />}
            onClick={() => {
              setEditing(previewTemplate);
              setDialogOpen(true);
            }}
          >
            Edit template
          </Button>
        ) : null}
      >
        {preview ? (
          <Stack spacing={1.5}>
            <div className="comms-preview-block">
              <span>Subject</span>
              <strong>{preview.subject.output}</strong>
            </div>
            <div className="comms-preview-block">
              <span>Rendered email</span>
              <div className="comms-preview-frame" dangerouslySetInnerHTML={{ __html: preview.html.output }} />
            </div>
            {[...preview.subject.warnings, ...preview.html.warnings, ...preview.text.warnings].map((warning) => (
              <Typography key={warning} color="warning.main" variant="body2">{warning}</Typography>
            ))}
          </Stack>
        ) : null}
      </QuickViewDrawer>

      <Dialog open={mergeFieldsOpen} onClose={() => setMergeFieldsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Merge Fields</DialogTitle>
        <DialogContent>
          <div className="comms-field-cloud">
            {mergeFields.map((field) => (
              <Chip key={field} label={`{{${field}}}`} size="small" />
            ))}
          </div>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setMergeFieldsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
