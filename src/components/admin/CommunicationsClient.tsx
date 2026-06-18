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

const tabs = ["Outbox", "Issues", "Templates"] as const;
const communicationStatuses = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"];
const recipientScopes = ["ALL_PARTICIPANTS", "PRIMARY_CONTACTS", "BILLING_CONTACTS", "CUSTOM"];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToEmailHtml(value: string) {
  const blocks = value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return "<p></p>";
  }

  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function htmlToTemplateText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function templateText(template?: AdminRow | null) {
  return String(template?.bodyText || htmlToTemplateText(String(template?.bodyHtml ?? "")) || "");
}

function templatePurpose(type?: string | null) {
  switch (type) {
    case "REGISTRATION_CONFIRMATION":
      return "Confirms a new registration with the POC.";
    case "WEEK_BEFORE_REMINDER":
      return "Session reminder sent about one week before.";
    case "DAY_BEFORE_REMINDER":
      return "Session reminder sent about 24 hours before.";
    case "HOUR_BEFORE_REMINDER":
      return "Session reminder sent about 60 minutes before.";
    case "FOLLOW_UP":
      return "General follow-up for roster, documents, or next steps.";
    case "PAYMENT_REMINDER":
      return "Payment follow-up for unpaid or pending registrations.";
    default:
      return "Custom operational email.";
  }
}

function templateUpdatedLabel(template: AdminRow) {
  return formatDate(template.updatedAt ?? template.createdAt, "No update date");
}

function bodySnippet(value: string, fallback = "No email body yet") {
  return value.replace(/\s+/g, " ").trim() || fallback;
}

function messageBodyPreview(message?: AdminRow | null) {
  const text = templateText(message);
  if (text) {
    return {
      text: renderMergeFields(text, sampleMergeContext, true),
      html: ""
    };
  }

  return {
    text: { output: "", warnings: [] as string[] },
    html: String(message?.bodyHtml ?? "")
  };
}

function parseRecipientEmails(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ));
}

function formatDate(value?: string | Date | null, empty = "Not scheduled") {
  if (!value) {
    return empty;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US") : empty;
}

function formatDateTime(value?: string | Date | null, empty = "No timestamp") {
  if (!value) {
    return empty;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-US") : empty;
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

function resourceAttachmentKey(resource: AdminRow) {
  return resource.fileKey || `resource:${resource.id}`;
}

function resourceDisplayType(resource: AdminRow) {
  return [formatStatusLabel(String(resource.type ?? "Material")), resource.session?.title].filter(Boolean).join(" · ");
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

function TemplateEditorDialog({
  open,
  editing,
  onClose,
  onSubmit
}: {
  open: boolean;
  editing: AdminRow | null;
  onClose: () => void;
  onSubmit: (values: AdminRow) => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>({ type: "CUSTOM", active: true, bodyText: "" });
  const [saving, setSaving] = useState(false);
  const [activeField, setActiveField] = useState<"subject" | "bodyText">("bodyText");
  const bodyText = String(values.bodyText ?? "");
  const renderedSubject = renderMergeFields(String(values.subject ?? ""), sampleMergeContext, true);
  const renderedBody = renderMergeFields(bodyText, sampleMergeContext, true);
  const warnings = [...renderedSubject.warnings, ...renderedBody.warnings];

  useEffect(() => {
    if (open) {
      setValues(editing ? { ...editing, bodyText: templateText(editing) } : { type: "CUSTOM", active: true, bodyText: "" });
      setActiveField("bodyText");
    }
  }, [editing, open]);

  function setValue(field: string, value: unknown) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function insertMergeField(field: string) {
    const token = `{{${field}}}`;
    setValues((current) => {
      const currentValue = String(current[activeField] ?? "");
      const separator = currentValue && !currentValue.endsWith(" ") && !currentValue.endsWith("\n") ? " " : "";
      return { ...current, [activeField]: `${currentValue}${separator}${token}` };
    });
  }

  async function save() {
    const subject = String(values.subject ?? "").trim();
    const text = bodyText.trim();

    if (!String(values.name ?? "").trim() || !subject || !text) {
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        ...values,
        name: String(values.name ?? "").trim(),
        subject,
        bodyText: text,
        bodyHtml: textToEmailHtml(text),
        type: values.type || "CUSTOM",
        active: Boolean(values.active)
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{editing ? "Edit template" : "Create template"}</DialogTitle>
      <DialogContent>
        <div className="template-editor">
          <div className="template-editor-form">
            <div className="template-editor-grid">
              <TextField label="Template name" value={values.name ?? ""} onChange={(event) => setValue("name", event.target.value)} required />
              <TextField select label="Type" value={values.type ?? "CUSTOM"} onChange={(event) => setValue("type", event.target.value)}>
                {templateTypes.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
              </TextField>
            </div>
            <TextField
              label="Subject"
              value={values.subject ?? ""}
              onFocus={() => setActiveField("subject")}
              onChange={(event) => setValue("subject", event.target.value)}
              required
            />
            <TextField
              label="Email body"
              multiline
              minRows={10}
              value={bodyText}
              onFocus={() => setActiveField("bodyText")}
              onChange={(event) => setValue("bodyText", event.target.value)}
              helperText="Write this like a normal email. Blank lines become paragraph breaks."
              required
            />
            <label className="template-editor-active">
              <input type="checkbox" checked={Boolean(values.active)} onChange={(event) => setValue("active", event.target.checked)} />
              <span>Active template</span>
            </label>
          </div>
          <aside className="template-editor-side">
            <div>
              <h3>Merge fields</h3>
              <p>Click a field to insert it into the {activeField === "subject" ? "subject" : "email body"}.</p>
            </div>
            <div className="comms-field-cloud">
              {mergeFields.map((field) => (
                <button className="template-merge-token" type="button" key={field} onClick={() => insertMergeField(field)}>
                  {`{{${field}}}`}
                </button>
              ))}
            </div>
            <div className="template-preview">
              <span>Preview</span>
              <strong>{renderedSubject.output || "Subject preview"}</strong>
              <div className="comms-preview-frame" dangerouslySetInnerHTML={{ __html: textToEmailHtml(renderedBody.output || "Email body preview") }} />
            </div>
            {warnings.length > 0 && (
              <div className="template-editor-warnings">
                {Array.from(new Set(warnings)).map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || !String(values.name ?? "").trim() || !String(values.subject ?? "").trim() || !bodyText.trim()}>
          {saving ? "Saving" : "Save template"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ComposeMessageDialog({
  open,
  cohorts,
  templates,
  defaultCohortId,
  onClose,
  onSubmit
}: {
  open: boolean;
  cohorts: AdminRow[];
  templates: AdminRow[];
  defaultCohortId?: string;
  onClose: () => void;
  onSubmit: (values: AdminRow, action: "draft" | "schedule" | "send") => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>({
    cohortId: "",
    sessionId: "",
    templateId: "",
    recipientScope: "ALL_PARTICIPANTS",
    recipientEmailsText: "",
    subject: "",
    bodyText: "",
    scheduledFor: ""
  });
  const [savingAction, setSavingAction] = useState<"draft" | "schedule" | "send" | null>(null);
  const selectedCohort = cohorts.find((cohort) => cohort.id === values.cohortId);
  const selectedTemplate = templates.find((template) => template.id === values.templateId);
  const bodyText = String(values.bodyText ?? "");
  const renderedSubject = renderMergeFields(String(values.subject ?? ""), sampleMergeContext, true);
  const renderedBody = renderMergeFields(bodyText, sampleMergeContext, true);
  const warnings = [...renderedSubject.warnings, ...renderedBody.warnings];
  const customEmails = parseRecipientEmails(String(values.recipientEmailsText ?? ""));

  useEffect(() => {
    if (open) {
      setValues({
        cohortId: defaultCohortId ?? "",
        sessionId: "",
        templateId: "",
        recipientScope: "ALL_PARTICIPANTS",
        recipientEmailsText: "",
        subject: "",
        bodyText: "",
        scheduledFor: ""
      });
      setSavingAction(null);
    }
  }, [defaultCohortId, open]);

  function setValue(field: string, value: unknown) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setValues((current) => ({
      ...current,
      templateId,
      subject: template?.subject ?? current.subject ?? "",
      bodyText: templateText(template) || String(current.bodyText ?? "")
    }));
  }

  async function submit(action: "draft" | "schedule" | "send") {
    setSavingAction(action);
    try {
      await onSubmit(values, action);
      onClose();
    } finally {
      setSavingAction(null);
    }
  }

  const canSave =
    Boolean(values.cohortId) &&
    Boolean(String(values.subject ?? "").trim()) &&
    Boolean(bodyText.trim()) &&
    (values.recipientScope !== "CUSTOM" || customEmails.length > 0);
  const canSchedule = canSave && Boolean(values.scheduledFor);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Create message</DialogTitle>
      <DialogContent>
        <div className="compose-message-editor">
          <div className="compose-message-form">
            <div className="compose-message-grid">
              <TextField select label="Cohort" value={values.cohortId ?? ""} onChange={(event) => setValue("cohortId", event.target.value)} required>
                <MenuItem value="">Choose cohort</MenuItem>
                {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
              </TextField>
              <TextField select label="Session" value={values.sessionId ?? ""} onChange={(event) => setValue("sessionId", event.target.value)}>
                <MenuItem value="">All sessions</MenuItem>
                {(selectedCohort?.sessions ?? []).map((session: AdminRow) => (
                  <MenuItem value={session.id} key={session.id}>{session.title}</MenuItem>
                ))}
              </TextField>
            </div>
            <div className="compose-message-grid">
              <TextField select label="Audience" value={values.recipientScope ?? "ALL_PARTICIPANTS"} onChange={(event) => setValue("recipientScope", event.target.value)}>
                {recipientScopes.map((scope) => <MenuItem value={scope} key={scope}>{formatStatusLabel(scope)}</MenuItem>)}
              </TextField>
              <TextField select label="Template" value={values.templateId ?? ""} onChange={(event) => applyTemplate(event.target.value)}>
                <MenuItem value="">No template</MenuItem>
                {templates.filter((template) => template.active).map((template) => <MenuItem value={template.id} key={template.id}>{template.name}</MenuItem>)}
              </TextField>
            </div>
            {values.recipientScope === "CUSTOM" && (
              <TextField
                label="Custom recipients"
                value={values.recipientEmailsText ?? ""}
                onChange={(event) => setValue("recipientEmailsText", event.target.value)}
                helperText="Separate emails with commas, spaces, or new lines."
                multiline
                minRows={2}
                required
              />
            )}
            <TextField label="Subject" value={values.subject ?? ""} onChange={(event) => setValue("subject", event.target.value)} required />
            <TextField
              label="Email body"
              multiline
              minRows={8}
              value={bodyText}
              onChange={(event) => setValue("bodyText", event.target.value)}
              helperText={selectedTemplate ? `Started from ${selectedTemplate.name}. Edits here affect only this message.` : "Write the message like a normal email."}
              required
            />
            <TextField
              label="Schedule for"
              type="datetime-local"
              value={values.scheduledFor ?? ""}
              onChange={(event) => setValue("scheduledFor", event.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText="Optional. Required only when scheduling."
            />
          </div>
          <aside className="compose-message-side">
            <div className="compose-message-context">
              <span>Context</span>
              <strong title={selectedCohort?.title ?? ""}>{selectedCohort?.title ?? "Choose a cohort"}</strong>
              <p title={selectedTemplate?.name ?? ""}>
                {[selectedTemplate?.name, values.recipientScope ? formatStatusLabel(String(values.recipientScope)) : ""].filter(Boolean).join(" · ") || "Template and audience will appear here."}
              </p>
            </div>
            <div className="template-preview">
              <span>Preview</span>
              <strong>{renderedSubject.output || "Subject preview"}</strong>
              <div className="comms-preview-frame comms-message-body-frame" dangerouslySetInnerHTML={{ __html: textToEmailHtml(renderedBody.output || "Email body preview") }} />
            </div>
            {customEmails.length > 0 && (
              <div className="compose-recipient-summary">
                <span>Custom recipients</span>
                <strong>{customEmails.length}</strong>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="template-editor-warnings">
                {Array.from(new Set(warnings)).map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={Boolean(savingAction)}>Cancel</Button>
        <Button variant="outlined" onClick={() => submit("draft")} disabled={!canSave || Boolean(savingAction)}>
          {savingAction === "draft" ? "Saving" : "Save draft"}
        </Button>
        <Button variant="outlined" onClick={() => submit("schedule")} disabled={!canSchedule || Boolean(savingAction)}>
          {savingAction === "schedule" ? "Scheduling" : "Schedule"}
        </Button>
        <Button onClick={() => submit("send")} disabled={!canSave || Boolean(savingAction)}>
          {savingAction === "send" ? "Sending" : "Send now"}
        </Button>
      </DialogActions>
    </Dialog>
  );
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [mergeFieldsOpen, setMergeFieldsOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminRow | null>(null);
  const [messageDetail, setMessageDetail] = useState<AdminRow | null>(null);
  const [messageResources, setMessageResources] = useState<AdminRow[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
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

  useEffect(() => {
    if (!messageDetail?.cohortId) {
      setMessageResources([]);
      return;
    }

    setLoadingResources(true);
    adminApi<AdminRow[]>(`/api/resources?cohortId=${messageDetail.cohortId}`)
      .then(setMessageResources)
      .catch((error) => notifyError((error as Error).message))
      .finally(() => setLoadingResources(false));
  }, [messageDetail?.cohortId, notifyError]);

  const preview = useMemo(() => {
    if (!previewTemplate) {
      return null;
    }

    return {
      subject: renderMergeFields(previewTemplate.subject ?? "", sampleMergeContext, true),
      text: renderMergeFields(templateText(previewTemplate), sampleMergeContext, true)
    };
  }, [previewTemplate]);
  const messagePreview = useMemo(() => messageBodyPreview(messageDetail), [messageDetail]);

  const selectedCohort = cohorts.find((cohort) => cohort.id === selectedCohortId);
  const activeTemplates = templates.filter((template) => template.active).length;
  const templateUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    communications.forEach((communication) => {
      const templateId = communication.templateId ?? communication.template?.id;
      if (templateId) {
        counts.set(String(templateId), (counts.get(String(templateId)) ?? 0) + 1);
      }
    });
    return counts;
  }, [communications]);
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

  async function createMessage(values: AdminRow, action: "draft" | "schedule" | "send") {
    const bodyText = String(values.bodyText ?? "").trim();
    const scheduledFor = values.scheduledFor ? new Date(String(values.scheduledFor)).toISOString() : undefined;
    const recipientScope = String(values.recipientScope ?? "ALL_PARTICIPANTS");
    const recipientEmails = recipientScope === "CUSTOM" ? parseRecipientEmails(String(values.recipientEmailsText ?? "")) : undefined;

    try {
      const communication = await adminApi<AdminRow>("/api/communications", {
        method: "POST",
        body: {
          cohortId: values.cohortId,
          sessionId: values.sessionId || undefined,
          templateId: values.templateId || undefined,
          subject: String(values.subject ?? "").trim(),
          bodyHtml: textToEmailHtml(bodyText),
          bodyText,
          scheduledFor: action === "schedule" ? scheduledFor : undefined,
          status: action === "schedule" ? "SCHEDULED" : "DRAFT",
          recipientScope,
          recipientEmails
        }
      });

      if (action === "send") {
        await adminApi("/api/communications", { method: "PATCH", body: { id: communication.id, action: "send" } });
        notifySuccess("Message created and sent");
      } else {
        notifySuccess(action === "schedule" ? "Message scheduled" : "Draft created");
      }

      await load(selectedCohortId);
      setActiveTab(0);
      setStatusFilter("");
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function attachResource(resource: AdminRow) {
    if (!messageDetail) {
      return;
    }

    try {
      const attachment = await adminApi<AdminRow>("/api/communications", {
        method: "PATCH",
        body: {
          action: "attachResource",
          communicationId: messageDetail.id,
          resourceId: resource.id
        }
      });
      setMessageDetail((current) => current ? { ...current, attachments: [...(current.attachments ?? []), attachment] } : current);
      notifySuccess("Material linked to message");
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
      minWidth: 260,
      renderCell: (params) => {
        const type = formatStatusLabel(String(params.row.type ?? "Custom"));
        const usageCount = templateUsageCounts.get(String(params.row.id)) ?? 0;
        const helper = `${type} · ${usageCount} message${usageCount === 1 ? "" : "s"} · Updated ${templateUpdatedLabel(params.row)}`;
        return (
          <div className="app-table-identity">
            <span className="app-table-main" title={params.row.name}>{params.row.name}</span>
            <span className="app-table-sub" title={helper}>{helper}</span>
          </div>
        );
      }
    },
    {
      field: "content",
      headerName: "Content",
      flex: 1.7,
      minWidth: 330,
      renderCell: (params) => {
        const subject = String(params.row.subject ?? "No subject");
        const snippet = bodySnippet(templateText(params.row));
        return (
          <div className="app-table-context">
            <span className="app-table-main" title={subject}>{subject}</span>
            <span className="app-table-sub" title={snippet}>{snippet}</span>
          </div>
        );
      }
    },
    {
      field: "active",
      headerName: "Status",
      width: 132,
      renderCell: (params) => <StatusChip value={params.value ? "Active" : "Inactive"} />
    },
    {
      field: "purpose",
      headerName: "Purpose",
      flex: 0.9,
      minWidth: 220,
      renderCell: (params) => (
        <span className="app-table-sub" title={templatePurpose(String(params.row.type ?? ""))}>
          {templatePurpose(String(params.row.type ?? ""))}
        </span>
      )
    },
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
  const attachedResourceKeys = new Set((messageDetail?.attachments ?? []).map((attachment: AdminRow) => attachment.fileKey));
  const eligibleResources = messageResources.filter((resource) => (
    !messageDetail?.sessionId ||
    !resource.sessionId ||
    resource.sessionId === messageDetail.sessionId
  ));
  const availableResources = eligibleResources.filter((resource) => !attachedResourceKeys.has(resourceAttachmentKey(resource)));

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Monitor scheduled messages, delivery health, recipient issues, templates, and send/resend operations."
        action={
          <ActionGroup>
            <Button variant="outlined" startIcon={<EmailOutlined />} onClick={() => setMergeFieldsOpen(true)}>Merge Fields</Button>
            <ToolbarButton onClick={() => setComposeOpen(true)}>Create Message</ToolbarButton>
            <ToolbarButton onClick={() => { setEditing(null); setDialogOpen(true); }}>Create Template</ToolbarButton>
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

            <SectionCard title="Email Body">
              {messagePreview.text.output ? (
                <>
                  <div
                    className="comms-preview-frame comms-message-body-frame"
                    dangerouslySetInnerHTML={{ __html: textToEmailHtml(messagePreview.text.output) }}
                  />
                  {messagePreview.text.warnings.length > 0 && (
                    <div className="template-editor-warnings">
                      {Array.from(new Set(messagePreview.text.warnings)).map((warning) => <span key={warning}>{warning}</span>)}
                    </div>
                  )}
                </>
              ) : messagePreview.html ? (
                <div
                  className="comms-preview-frame comms-message-body-frame"
                  dangerouslySetInnerHTML={{ __html: messagePreview.html }}
                />
              ) : (
                <Typography color="text.secondary">This message does not have an email body yet.</Typography>
              )}
            </SectionCard>

            <SectionCard title="Materials">
              <div className="comms-material-picker">
                {loadingResources ? (
                  <Typography color="text.secondary">Loading materials...</Typography>
                ) : eligibleResources.length > 0 ? (
                  <>
                    {eligibleResources.map((resource) => {
                      const linked = attachedResourceKeys.has(resourceAttachmentKey(resource));
                      const href = resource.url || (resource.muxPlaybackId ? `https://stream.mux.com/${resource.muxPlaybackId}` : "");
                      return (
                        <div className={`comms-material-row ${linked ? "is-linked" : ""}`.trim()} key={resource.id}>
                          <div>
                            <strong title={resource.title}>{resource.title}</strong>
                            <span title={resourceDisplayType(resource)}>{resourceDisplayType(resource)}</span>
                          </div>
                          <ActionGroup>
                            {href ? <Button href={href} target="_blank" rel="noreferrer" variant="text" size="small">Open</Button> : null}
                            <Button variant={linked ? "text" : "outlined"} size="small" disabled={linked} onClick={() => attachResource(resource)}>
                              {linked ? "Linked" : "Attach"}
                            </Button>
                          </ActionGroup>
                        </div>
                      );
                    })}
                    {availableResources.length === 0 && <Typography color="text.secondary">All eligible materials are linked to this message.</Typography>}
                  </>
                ) : (
                  <Typography color="text.secondary">No cohort or session materials are available for this message yet.</Typography>
                )}
              </div>
            </SectionCard>

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
              <div className="comms-preview-frame" dangerouslySetInnerHTML={{ __html: textToEmailHtml(preview.text.output) }} />
            </div>
            {[...preview.subject.warnings, ...preview.text.warnings].map((warning) => (
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

      <TemplateEditorDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={save}
      />
      <ComposeMessageDialog
        open={composeOpen}
        cohorts={cohorts}
        templates={templates}
        defaultCohortId={selectedCohortId}
        onClose={() => setComposeOpen(false)}
        onSubmit={createMessage}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
