"use client";

import {
  CheckCircleOutline,
  DeleteOutline,
  EditOutlined,
  EmailOutlined,
  PowerSettingsNewOutlined,
  SendOutlined,
  VisibilityOutlined
} from "@/components/ui/icons";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
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
const communicationStatuses = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"];

function formatDate(value?: string | Date | null, empty = "Not scheduled") {
  if (!value) {
    return empty;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : empty;
}

function formatDateTime(value?: string | Date | null, empty = "No timestamp") {
  if (!value) {
    return empty;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : empty;
}

function DeliverySummary({ row }: { row: AdminRow }) {
  const summary = row.emailSummary ?? {};
  const delivered = Number(summary.deliveredCount ?? 0);
  const opened = Number(summary.openedCount ?? 0);
  const clicked = Number(summary.clickedCount ?? 0);
  const bounced = Number(summary.bouncedCount ?? 0);
  const failed = Number(summary.failedCount ?? 0);

  return (
    <div className="comms-delivery-strip" title={`Delivered ${delivered}, opened ${opened}, clicked ${clicked}, bounced ${bounced}, failed ${failed}`}>
      <span className="is-success">D {delivered}</span>
      <span>O {opened}</span>
      <span>C {clicked}</span>
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
      <p title={helper}>{helper}</p>
    </div>
  );
}

function relatedLabel(related?: AdminRow | null) {
  if (!related) {
    return "No related record";
  }
  const name = formatProperDisplay(related.displayName ?? "");
  const organization = formatProperDisplay(related.organizationName ?? "");
  return [name, organization].filter(Boolean).join(" · ") || "Related record";
}

function recipientSearchText(row: AdminRow) {
  return [
    row.recipientEmail,
    row.subject,
    row.cohort?.title,
    row.session?.title,
    row.template?.name,
    row.related?.displayName,
    row.related?.organizationName
  ].join(" ").toLowerCase();
}

export function CommunicationsClient() {
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [messageSearch, setMessageSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mergeFieldsOpen, setMergeFieldsOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminRow | null>(null);
  const [messageDetail, setMessageDetail] = useState<AdminRow | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ communicationId: string; recipientEmail: string; subject?: string; latestEvent?: string | null } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewingIssue, setReviewingIssue] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [communicationHealthWarnings, setCommunicationHealthWarnings] = useState<string[]>([]);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load(nextCohortId = selectedCohortId) {
    const [templateRows, cohortRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/communications/templates"),
      adminApi<AdminRow[]>("/api/cohorts")
    ]);
    setTemplates(templateRows);
    setCohorts(cohortRows);
    setSelectedCohortId(nextCohortId);

    const params = new URLSearchParams({ limit: "150" });
    if (nextCohortId) {
      params.set("cohortId", nextCohortId);
    }
    setCommunications(await adminApi<AdminRow[]>(`/api/communications?${params.toString()}`));
    setLoading(false);
  }

  useEffect(() => {
    const search = new URLSearchParams(window.location.search).get("search");
    if (search) {
      setMessageSearch(search);
    }
    adminApi<AdminRow>("/api/system-health")
      .then((health) => {
        const integrationChecks = (health.groups ?? []).find((group: AdminRow) => group.key === "integrations")?.checks ?? [];
        setCommunicationHealthWarnings(
          integrationChecks
            .filter((check: AdminRow) => ["sendgrid", "sendgridWebhook"].includes(String(check.key)) && check.status !== "healthy")
            .map((check: AdminRow) => `${check.label}: ${check.detail}`)
        );
      })
      .catch(() => setCommunicationHealthWarnings([]));
    load("").catch((error) => {
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
  const issueRows = communications.flatMap((communication) => communication.issueRows ?? []);
  const filteredMessages = communications.filter((row) => {
    const matchStatus = statusFilter ? row.status === statusFilter : true;
    const matchSearch = [
      row.subject,
      row.template?.name,
      row.recipientScope,
      row.session?.title,
      row.cohort?.title,
      row.status
    ].join(" ").toLowerCase().includes(messageSearch.toLowerCase());
    return matchStatus && matchSearch;
  });
  const filteredIssues = issueRows.filter((row) => recipientSearchText(row).includes(messageSearch.toLowerCase()));
  const scheduledMessages = communications.filter((row) => row.scheduledFor && !row.sentAt).length;
  const sentMessages = communications.filter((row) => row.sentAt).length;
  const deliveryTotals = communications.reduce(
    (total, row) => {
      const summary = row.emailSummary ?? {};
      total.delivered += Number(summary.deliveredCount ?? 0);
      total.opened += Number(summary.openedCount ?? 0);
      total.failed += Number(summary.unreviewedIssueCount ?? 0);
      return total;
    },
    { delivered: 0, opened: 0, failed: 0 }
  );
  const openRate = deliveryTotals.delivered > 0 ? `${Math.round((deliveryTotals.opened / deliveryTotals.delivered) * 100)}%` : "0%";

  async function refreshAfterMutation(nextMessageDetail?: AdminRow | null) {
    await load(selectedCohortId);
    if (nextMessageDetail === null) {
      setMessageDetail(null);
    }
  }

  async function save(values: AdminRow) {
    try {
      await adminApi("/api/communications/templates", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Template updated" : "Template created");
      setEditing(null);
      await load(selectedCohortId);
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function toggleTemplate(template: AdminRow) {
    try {
      await adminApi("/api/communications/templates", { method: "PATCH", body: { id: template.id, active: !template.active } });
      notifySuccess(template.active ? "Template deactivated" : "Template activated");
      await load(selectedCohortId);
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendCommunication(communication: AdminRow, action: "send" | "resend") {
    try {
      await adminApi("/api/communications", { method: "PATCH", body: { id: communication.id, action } });
      notifySuccess(action === "resend" ? "Communication resent" : "Communication sent");
      await refreshAfterMutation(null);
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendToRecipient(communicationId: string, recipientEmail: string) {
    try {
      await adminApi("/api/communications", { method: "PATCH", body: { action: "sendToRecipient", communicationId, recipientEmail } });
      notifySuccess(`Message resent to ${recipientEmail}`);
      await refreshAfterMutation(null);
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  function openReviewIssue(input: { communicationId: string; recipientEmail: string; subject?: string; latestEvent?: string | null }) {
    setReviewTarget(input);
    setReviewNote("");
  }

  async function reviewIssue() {
    if (!reviewTarget) {
      return;
    }

    setReviewingIssue(true);
    try {
      const result = await adminApi<AdminRow>("/api/communications", {
        method: "PATCH",
        body: {
          action: "reviewRecipientIssue",
          communicationId: reviewTarget.communicationId,
          recipientEmail: reviewTarget.recipientEmail,
          reviewNote: reviewNote.trim() || undefined
        }
      });
      if (result?.migrationRequired) {
        notifyError(result.message ?? "Production migration is required before issues can be reviewed.");
        return;
      }
      notifySuccess("Issue marked reviewed");
      setReviewTarget(null);
      setReviewNote("");
      await refreshAfterMutation(null);
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setReviewingIssue(false);
    }
  }

  async function attachFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !messageDetail) {
      return;
    }

    setUploadingAttachment(true);
    try {
      const upload = await uploadAdminFile<{ provider: string; fileKey: string; url?: string }>(file, "email-attachment");
      const attachment = await adminApi<AdminRow>("/api/communications", {
        method: "PATCH",
        body: {
          action: "attachFile",
          communicationId: messageDetail.id,
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
          fileKey: upload.fileKey,
          url: upload.url
        }
      });
      setMessageDetail((current) => current ? { ...current, attachments: [...(current.attachments ?? []), attachment] } : current);
      notifySuccess("Attachment added");
      await load(selectedCohortId);
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function removeAttachment(attachmentId: string) {
    try {
      await adminApi("/api/communications", { method: "PATCH", body: { action: "removeAttachment", attachmentId } });
      setMessageDetail((current) => current ? { ...current, attachments: (current.attachments ?? []).filter((attachment: AdminRow) => attachment.id !== attachmentId) } : current);
      notifySuccess("Attachment removed");
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
      minWidth: 280,
      renderCell: (params) => {
        const helper = [params.row.cohort?.title, params.row.template?.name ?? "Custom"].filter(Boolean).join(" · ");
        return (
          <div className="app-table-identity">
            <span className="app-table-main" title={params.row.subject}>{params.row.subject || "Untitled message"}</span>
            <span className="app-table-sub" title={helper}>{helper || "No context"}</span>
          </div>
        );
      }
    },
    {
      field: "audience",
      headerName: "Audience",
      flex: 1,
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
    { field: "delivery", headerName: "Delivery", width: 164, renderCell: (params) => <DeliverySummary row={params.row} /> },
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

  const issueColumns: GridColDef[] = [
    {
      field: "recipientEmail",
      headerName: "Recipient",
      flex: 1.25,
      minWidth: 250,
      renderCell: (params) => (
        <div className="app-table-identity">
          <span className="app-table-main" title={params.row.recipientEmail}>{params.row.recipientEmail}</span>
          <span className="app-table-sub" title={relatedLabel(params.row.related)}>{relatedLabel(params.row.related)}</span>
        </div>
      )
    },
    {
      field: "subject",
      headerName: "Message",
      flex: 1.25,
      minWidth: 250,
      renderCell: (params) => (
        <div className="app-table-context">
          <span className="app-table-main" title={params.row.subject}>{params.row.subject}</span>
          <span className="app-table-sub" title={params.row.cohort?.title ?? ""}>{params.row.cohort?.title ?? "No cohort"}</span>
        </div>
      )
    },
    { field: "latestEvent", headerName: "Issue", width: 116, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "latestEventAt", headerName: "Date", width: 120, valueFormatter: (value) => formatDate(value, "-") },
    {
      field: "actions",
      headerName: "Actions",
      width: 92,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Resend to recipient", icon: <SendOutlined fontSize="small" />, onClick: () => sendToRecipient(params.row.communicationId, params.row.recipientEmail) },
              {
                label: "Mark reviewed",
                icon: <CheckCircleOutline fontSize="small" />,
                onClick: () => openReviewIssue({
                  communicationId: String(params.row.communicationId),
                  recipientEmail: String(params.row.recipientEmail),
                  subject: params.row.subject,
                  latestEvent: params.row.latestEvent
                })
              },
              ...(params.row.related?.registrationHref ? [{ label: "Open registration", icon: <VisibilityOutlined fontSize="small" />, onClick: () => { window.location.href = params.row.related.registrationHref; } }] : []),
              ...(params.row.related?.participantHref ? [{ label: "Open participant", icon: <VisibilityOutlined fontSize="small" />, onClick: () => { window.location.href = params.row.related.participantHref; } }] : [])
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

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Monitor scheduled messages, delivery health, recipient issues, templates, and send/resend operations."
        action={
          <ActionGroup>
            <Button variant="outlined" startIcon={<EmailOutlined />} onClick={() => setMergeFieldsOpen(true)}>Merge Fields</Button>
            <ToolbarButton onClick={() => setDialogOpen(true)}>Create Template</ToolbarButton>
          </ActionGroup>
        }
      />

      {communicationHealthWarnings.length > 0 && (
        <Alert severity="warning">
          {communicationHealthWarnings.join(" ")}
        </Alert>
      )}

      <div className="comms-summary-grid">
        <CommunicationsStat label="Scheduled" value={scheduledMessages} helper="Messages queued across the current filter" tone="primary" />
        <CommunicationsStat label="Sent" value={sentMessages} helper="Messages already delivered or attempted" tone="success" />
        <CommunicationsStat label="Issues" value={issueRows.length} helper="Unreviewed failed or bounced recipients" tone={issueRows.length ? "error" : "success"} />
        <CommunicationsStat label="Open rate" value={openRate} helper={`${deliveryTotals.opened} opens from ${deliveryTotals.delivered} delivered`} tone="warning" />
        <CommunicationsStat label="Templates" value={`${activeTemplates}/${templates.length}`} helper="Active templates in library" />
      </div>

      <SectionCard
        title="Message Workspace"
        action={
          <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => load(event.target.value)} sx={{ width: 300, maxWidth: "100%" }}>
            <MenuItem value="">All cohorts</MenuItem>
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
            {tabs.map((label) => <Tab key={label} label={label === "Issues" && issueRows.length ? `Issues (${issueRows.length})` : label} />)}
          </Tabs>
          <span title={selectedCohort?.title ?? "All cohorts"}>{selectedCohort?.title ?? "All cohorts"}</span>
        </div>

        {activeTab < 2 ? (
          <>
            <CompactFilterBar resultCount={activeTab === 1 ? filteredIssues.length : filteredMessages.length}>
              <TextField label={activeTab === 1 ? "Search issues" : "Search messages"} value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} sx={{ width: 280, maxWidth: "100%" }} />
              {activeTab === 0 && (
                <TextField select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ width: 190, maxWidth: "100%" }}>
                  <MenuItem value="">All statuses</MenuItem>
                  {communicationStatuses.map((status) => <MenuItem value={status} key={status}>{formatStatusLabel(status)}</MenuItem>)}
                </TextField>
              )}
            </CompactFilterBar>
            <TableShell>
              <AppDataGrid
                rows={activeTab === 1 ? filteredIssues : filteredMessages}
                columns={activeTab === 1 ? issueColumns : outboxColumns}
                loading={loading}
                pageSizeOptions={[10, 25]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                onRowClick={(params) => {
                  const communicationId = activeTab === 1 ? params.row.communicationId : params.row.id;
                  const communication = communications.find((row) => row.id === communicationId);
                  setMessageDetail(communication ?? null);
                }}
              />
            </TableShell>
            {!loading && (activeTab === 1 ? filteredIssues : filteredMessages).length === 0 && (
              <EmptyState
                title={activeTab === 1 ? "No communication issues" : "No scheduled messages"}
                description={activeTab === 1 ? "Unreviewed failed and bounced recipients will appear here." : "Scheduled, sent, and draft cohort messages will appear here."}
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
          <ActionGroup>
            <label className="ui-button ui-button-outlined ui-button-small">
              <input type="file" hidden onChange={attachFile} disabled={uploadingAttachment} />
              <span>{uploadingAttachment ? "Uploading" : "Attach file"}</span>
            </label>
            <Button
              startIcon={<SendOutlined />}
              onClick={() => sendCommunication(messageDetail, messageDetail.sentAt ? "resend" : "send")}
            >
              {messageDetail.sentAt ? "Resend" : "Send"}
            </Button>
          </ActionGroup>
        ) : null}
      >
        {messageDetail ? (
          <Stack spacing={1.5}>
            <div className="comms-message-hero">
              <span>Message</span>
              <strong title={messageDetail.subject}>{messageDetail.subject || "Untitled message"}</strong>
              <p title={[messageDetail.cohort?.title, messageDetail.session?.title, messageDetail.template?.name].filter(Boolean).join(" · ")}>
                {[messageDetail.cohort?.title, messageDetail.session?.title, messageDetail.template?.name ?? "Custom"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="comms-detail-grid">
              <div>
                <span>Cohort</span>
                <strong>{messageDetail.cohort?.title ?? "No cohort"}</strong>
              </div>
              <div>
                <span>Template</span>
                <strong>{messageDetail.template?.name ?? "Custom"}</strong>
              </div>
              <div>
                <span>Audience</span>
                <strong>{formatStatusLabel(String(messageDetail.recipientScope ?? "-"))}</strong>
              </div>
              <div>
                <span>Session</span>
                <strong>{messageDetail.session?.title ?? "All sessions"}</strong>
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

            <SectionCard title="Attachments">
              <div className="comms-attachment-list">
                {(messageDetail.attachments ?? []).map((attachment: AdminRow) => (
                  <div className="comms-attachment-row" key={attachment.id}>
                    <div>
                      <strong title={attachment.fileName}>{attachment.fileName}</strong>
                      <span>{attachment.contentType ?? "Attachment"} · {attachment.fileSize ? `${Math.round(Number(attachment.fileSize) / 1024)} KB` : "Size unknown"}</span>
                    </div>
                    <ActionGroup>
                      {attachment.url ? <Button href={attachment.url} target="_blank" rel="noreferrer" variant="text" size="small">Open</Button> : null}
                      <Button variant="text" color="error" size="small" startIcon={<DeleteOutline />} onClick={() => removeAttachment(attachment.id)}>Remove</Button>
                    </ActionGroup>
                  </div>
                ))}
                {(messageDetail.attachments ?? []).length === 0 && <Typography color="text.secondary">No attachments yet.</Typography>}
              </div>
            </SectionCard>

            <SectionCard title="Recipients">
              <div className="comms-recipient-list">
                {(messageDetail.recipientRows ?? []).map((recipient: AdminRow) => (
                  <div className={`comms-recipient-row ${recipient.needsReview ? "needs-review" : ""}`.trim()} key={recipient.recipientEmail}>
                    <div>
                      <strong title={recipient.recipientEmail}>{recipient.recipientEmail}</strong>
                      <span title={relatedLabel(recipient.related)}>{relatedLabel(recipient.related)}</span>
                    </div>
                    <DeliverySummary row={recipient} />
                    <div className="comms-recipient-events">
                      {(recipient.events ?? []).slice(0, 4).map((event: AdminRow) => (
                        <span key={event.id} title={formatDateTime(event.createdAt)}>
                          {formatStatusLabel(event.eventType)}
                        </span>
                      ))}
                    </div>
                    <ActionGroup>
                      {recipient.related?.registrationHref ? <Button href={recipient.related.registrationHref} variant="text" size="small">Registration</Button> : null}
                      {recipient.related?.participantHref ? <Button href={recipient.related.participantHref} variant="text" size="small">Participant</Button> : null}
                      {recipient.needsReview ? <Button variant="outlined" size="small" startIcon={<CheckCircleOutline />} onClick={() => openReviewIssue({ communicationId: messageDetail.id, recipientEmail: recipient.recipientEmail, subject: messageDetail.subject, latestEvent: recipient.latestEvent })}>Review</Button> : null}
                      <Button variant="outlined" size="small" startIcon={<SendOutlined />} onClick={() => sendToRecipient(messageDetail.id, recipient.recipientEmail)}>Resend</Button>
                    </ActionGroup>
                  </div>
                ))}
                {(messageDetail.recipientRows ?? []).length === 0 && <Typography color="text.secondary">No recipient events recorded yet.</Typography>}
              </div>
            </SectionCard>
          </Stack>
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

      <Dialog open={Boolean(reviewTarget)} onClose={() => setReviewTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Mark recipient issue reviewed</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Alert severity="info">
              This clears the recipient from the active Issues queue. The SendGrid event remains in the message timeline for audit.
            </Alert>
            <div className="comms-review-target">
              <span>Recipient</span>
              <strong title={reviewTarget?.recipientEmail}>{reviewTarget?.recipientEmail}</strong>
              <p title={reviewTarget?.subject ?? ""}>
                {[reviewTarget?.latestEvent ? formatStatusLabel(String(reviewTarget.latestEvent)) : "", reviewTarget?.subject].filter(Boolean).join(" · ")}
              </p>
            </div>
            <TextField
              label="Review note"
              multiline
              minRows={3}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              helperText="Optional, but useful when the issue was handled outside Mission Control."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setReviewTarget(null)} disabled={reviewingIssue}>Cancel</Button>
          <Button startIcon={<CheckCircleOutline />} onClick={reviewIssue} disabled={reviewingIssue}>
            {reviewingIssue ? "Saving" : "Mark reviewed"}
          </Button>
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
