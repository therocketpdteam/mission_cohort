"use client";

import { AddIcon } from "@/components/ui/icons";
import { CalendarMonthOutlined, GroupsOutlined, InsightsOutlined } from "@/components/ui/icons";
import { CancelOutlined, CheckCircleOutline, SendOutlined } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  DateBadge,
  DetailField,
  DonutChart,
  EmptyState,
  FieldConfig,
  GridRowSelectionModel,
  MutationDialog,
  PageHeader,
  PageStack,
  QuickViewDrawer,
  RowActionMenu,
  SectionCard,
  StatusChip,
  TableShell,
  useNotifier
} from "./common";

const sessionFields: FieldConfig[] = [
  { name: "title", label: "Session title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "sessionNumber", label: "Session number", type: "number", required: true },
  { name: "startTime", label: "Start time", type: "datetime-local", required: true },
  { name: "endTime", label: "End time", type: "datetime-local", required: true },
  { name: "timezone", label: "Timezone", required: true },
  { name: "meetingUrl", label: "Meeting URL" },
  { name: "location", label: "Location" }
];

const taskFields: FieldConfig[] = [
  { name: "title", label: "Task title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  {
    name: "category",
    label: "Category",
    type: "select",
    options: [
      "PARTICIPANT_LIST",
      "PAYMENT_FOLLOW_UP",
      "CALENDAR_INVITE",
      "REMINDER_EMAILS",
      "SESSION_RESOURCES",
      "RECORDING_LINK",
      "POST_SESSION_FOLLOW_UP",
      "SUPPORTING_DOCUMENTS",
      "QUICKBOOKS_REVIEW",
      "OTHER"
    ].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  },
  { name: "priority", label: "Priority", type: "select", options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => ({ label: formatStatusLabel(value), value })) },
  { name: "dueDate", label: "Due date", type: "datetime-local" },
  { name: "ownerName", label: "Owner" }
];

const resourceFields: FieldConfig[] = [
  { name: "title", label: "Title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  {
    name: "type",
    label: "Type",
    type: "select",
    options: ["VIDEO", "SLIDES", "PDF", "LINK", "WORKBOOK", "OTHER"].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  },
  { name: "url", label: "URL" },
  { name: "muxAssetId", label: "Mux asset ID" },
  { name: "muxPlaybackId", label: "Mux playback ID" },
  {
    name: "visibility",
    label: "Visibility",
    type: "select",
    options: ["ADMIN_ONLY", "PARTICIPANTS", "PUBLIC_LINK"].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  }
];

const sessionEmailTypes = [
  { type: "REGISTRATION_CONFIRMATION", label: "Registration Confirmation" },
  { type: "WEEK_BEFORE_REMINDER", label: "1 Week" },
  { type: "DAY_BEFORE_REMINDER", label: "24h" },
  { type: "HOUR_BEFORE_REMINDER", label: "60m" },
  { type: "FOLLOW_UP", label: "24h Post" }
];

const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];
const participantStatuses = ["REGISTERED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const rosterStatuses = ["NOT_REQUESTED", "NEEDED", "PARTIAL", "COMPLETE"];

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function registrationTrendPoints(rows: AdminRow[], mode: "count" | "amount") {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let cumulative = 0;
  return sorted.map((registration) => {
    cumulative += mode === "count" ? Number(registration.participantCount ?? 0) : Number(registration.totalAmount ?? 0);
    return { label: new Date(registration.createdAt).toLocaleDateString(), value: cumulative };
  });
}

function RegistrationEvolutionChart({
  rows,
  compareRows,
  compareLabel,
  mode
}: {
  rows: AdminRow[];
  compareRows: AdminRow[];
  compareLabel?: string;
  mode: "count" | "amount";
}) {
  const points = useMemo(() => registrationTrendPoints(rows, mode), [mode, rows]);
  const comparisonPoints = useMemo(() => registrationTrendPoints(compareRows, mode), [compareRows, mode]);
  const max = Math.max(...points.map((point) => point.value), ...comparisonPoints.map((point) => point.value), 1);
  const width = 720;
  const height = 180;
  const innerWidth = width - 64;
  const innerHeight = height - 48;

  function pathFor(nextPoints: Array<{ label: string; value: number }>) {
    return nextPoints.map((point, index) => {
      const x = 40 + (nextPoints.length <= 1 ? innerWidth : (index / (nextPoints.length - 1)) * innerWidth);
      const y = 16 + innerHeight - (point.value / max) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  }

  if (points.length === 0) {
    return <EmptyState title="No registration trend yet" description="Registrations will draw the cohort evolution chart here." />;
  }

  return (
    <div className="cohort-evolution-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Registration evolution chart">
        <line x1="40" y1={height - 32} x2={width - 24} y2={height - 32} stroke="var(--color-slate-200)" />
        <line x1="40" y1="16" x2="40" y2={height - 32} stroke="var(--color-slate-200)" />
        {comparisonPoints.length > 0 && <path d={pathFor(comparisonPoints)} fill="none" stroke="var(--color-slate-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 8" />}
        <path d={pathFor(points)} fill="none" stroke="var(--color-blue-600)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = 40 + (points.length <= 1 ? innerWidth : (index / (points.length - 1)) * innerWidth);
          const y = 16 + innerHeight - (point.value / max) * innerHeight;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="2.8" fill="var(--color-orange-500)" />;
        })}
        <text x="40" y="14" fill="var(--color-slate-500)" fontSize="12">{mode === "count" ? `${max} seats` : money(max)}</text>
        <text x="40" y={height - 8} fill="var(--color-slate-500)" fontSize="12">{points[0]?.label}</text>
        <text x={width - 150} y={height - 8} fill="var(--color-slate-500)" fontSize="12">{points.at(-1)?.label}</text>
      </svg>
      {comparisonPoints.length > 0 && <span>Comparing against {compareLabel}</span>}
    </div>
  );
}

function PaymentDetailDialog({
  payment,
  cohortId,
  templates,
  open,
  onClose,
  onChanged,
  onError
}: {
  payment: AdminRow | null;
  cohortId: string;
  templates: AdminRow[];
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<AdminRow | null>(null);

  useEffect(() => {
    if (payment) {
      setStatus(payment.status ?? "PENDING");
      setInvoiceNumber(payment.invoiceNumber ?? payment.registration?.invoiceNumber ?? "");
      setPurchaseOrderNumber(payment.registration?.purchaseOrderNumber ?? "");
      setInvoiceUrl(payment.registration?.invoiceUrl ?? "");
    }
  }, [payment]);

  async function updatePayment() {
    if (!payment) {
      return;
    }

    try {
      await adminApi("/api/payments", {
        method: "PATCH",
        body: { id: payment.id, status, invoiceNumber }
      });

      if (payment.registrationId) {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: { id: payment.registrationId, paymentStatus: status, invoiceNumber, purchaseOrderNumber, invoiceUrl }
        });
      }

      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function sendReminder() {
    if (!payment?.registrationId) {
      return;
    }

    try {
      const reminder = templates.find((template) => template.type === "PAYMENT_REMINDER" && template.active) ?? templates.find((template) => template.active);
      if (!reminder) {
        throw new Error("No active email template is available for payment reminders.");
      }

      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToRegistrations", templateId: reminder.id, registrationIds: [payment.registrationId] }
      });
      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>Payment Detail</DialogTitle>
        <DialogContent>
          {payment ? (
            <Grid container spacing={2}>
              {[
                ["Organization", payment.organization?.name ?? payment.registration?.organization?.name ?? "-"],
                ["Billing / POC", payment.registration?.billingContactName ?? payment.registration?.primaryContactName ?? "-"],
                ["Phone", payment.registration?.primaryContactPhone ?? payment.organization?.phone ?? "-"],
                ["Address", payment.registration?.billingAddress ?? payment.organization?.addressLine1 ?? "-"],
                ["Method", payment.method ?? payment.registration?.paymentMethod ?? "-"],
                ["Amount", money(payment.amount)],
                ["QuickBooks Sync", payment.quickBooksSyncStatus ?? payment.registration?.quickBooksSyncStatus ?? "NOT_SYNCED"],
                ["Last Touch Sent", payment.emailSummary?.lastEmailEventAt ? new Date(payment.emailSummary.lastEmailEventAt).toLocaleString() : "-"]
              ].map(([label, value]) => (
                <Grid size={{ xs: 12, sm: 6 }} key={label}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography>{value}</Typography>
                </Grid>
              ))}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField select fullWidth label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="Invoice number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="PO number" value={purchaseOrderNumber} onChange={(event) => setPurchaseOrderNumber(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="Invoice URL" value={invoiceUrl} onChange={(event) => setInvoiceUrl(event.target.value)} />
              </Grid>
            </Grid>
          ) : (
            <Typography color="text.secondary">No payment selected.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={async () => {
              if (!payment) return;
              try {
                const draft = await adminApi<AdminRow>("/api/invoices", {
                  method: "POST",
                  body: {
                    cohortId,
                    registrationId: payment.registrationId,
                    organizationId: payment.organizationId,
                    invoiceNumber,
                    purchaseOrderNumber,
                    paidAmount: payment.status === "PAID" ? payment.amount : 0
                  }
                });
                const withPdf = await adminApi<AdminRow>("/api/invoices", { method: "PATCH", body: { action: "generatePdf", id: draft.id } });
                setInvoiceDraft(withPdf);
                setDraftOpen(true);
                await onChanged();
              } catch (error) {
                onError((error as Error).message);
              }
            }}
          >
            Generate Invoice Draft
          </Button>
          <Button variant="outlined" onClick={sendReminder}>Send Reminder</Button>
          <Button variant="outlined" onClick={onClose}>Close</Button>
          <Button onClick={updatePayment}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={draftOpen} onClose={() => setDraftOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Invoice Draft</DialogTitle>
        <DialogContent>
          {invoiceDraft ? (
            <div className="quick-view-grid">
              <DetailField label="Invoice" value={invoiceDraft.invoiceNumber ?? invoiceDraft.id} />
              <DetailField label="Status" value={formatStatusLabel(invoiceDraft.status)} />
              <DetailField label="Total" value={money(invoiceDraft.totalAmount)} />
              <DetailField label="Paid" value={money(invoiceDraft.paidAmount)} />
              <DetailField label="PDF" value={invoiceDraft.pdfUrl ? "Generated" : "Pending"} />
            </div>
          ) : (
            <Typography color="text.secondary">Generate an invoice draft to preview the saved PDF status here.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          {invoiceDraft?.pdfUrl && <Button href={invoiceDraft.pdfUrl} variant="outlined" target="_blank" rel="noreferrer">Open PDF</Button>}
          {invoiceDraft && (
            <Button
              variant="outlined"
              onClick={async () => {
                try {
                  const receipt = await adminApi<AdminRow>("/api/invoices", { method: "PATCH", body: { action: "generatePdf", id: invoiceDraft.id, receipt: true } });
                  setInvoiceDraft(receipt);
                } catch (error) {
                  onError((error as Error).message);
                }
              }}
            >
              Generate Receipt
            </Button>
          )}
          <Button onClick={() => setDraftOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function CohortDetailClient({ id }: { id: string }) {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cohort, setCohort] = useState<AdminRow | null>(null);
  const [allCohorts, setAllCohorts] = useState<AdminRow[]>([]);
  const [allParticipants, setAllParticipants] = useState<AdminRow[]>([]);
  const [sessions, setSessions] = useState<AdminRow[]>([]);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [compareRegistrations, setCompareRegistrations] = useState<AdminRow[]>([]);
  const [participants, setParticipants] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [invoiceDrafts, setInvoiceDrafts] = useState<AdminRow[]>([]);
  const [distribution, setDistribution] = useState<AdminRow | null>(null);
  const [tasks, setTasks] = useState<AdminRow[]>([]);
  const [resources, setResources] = useState<AdminRow[]>([]);
  const [activity, setActivity] = useState<AdminRow[]>([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AdminRow | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [chartMode, setChartMode] = useState<"count" | "amount">("count");
  const [compareCohortId, setCompareCohortId] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [registrationPaymentFilter, setRegistrationPaymentFilter] = useState("");
  const [registrationRosterFilter, setRegistrationRosterFilter] = useState("");
  const [paymentDetail, setPaymentDetail] = useState<AdminRow | null>(null);
  const [registrationDetail, setRegistrationDetail] = useState<AdminRow | null>(null);
  const [registrationThread, setRegistrationThread] = useState<AdminRow[]>([]);
  const [registrationThreadLoading, setRegistrationThreadLoading] = useState(false);
  const [participantDetail, setParticipantDetail] = useState<AdminRow | null>(null);
  const [participantSelection, setParticipantSelection] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [bulkParticipantStatus, setBulkParticipantStatus] = useState("REGISTERED");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohortData, cohortRows, sessionRows, registrationRows, participantRows, allParticipantRows, communicationRows, templateRows, paymentRows, invoiceRows, distributionData, taskRows, resourceRows, activityRows] =
      await Promise.all([
        adminApi<AdminRow>(`/api/cohorts/${id}`),
        adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/sessions`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/registrations`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/participants`),
        adminApi<AdminRow[]>("/api/participants").catch(() => []),
        adminApi<AdminRow[]>(`/api/communications?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>("/api/communications/templates").catch(() => []),
        adminApi<AdminRow[]>("/api/payments").catch(() => []),
        adminApi<AdminRow[]>(`/api/invoices?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow>(`/api/distributions?cohortId=${id}`).catch(() => null),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/tasks`).catch(() => []),
        adminApi<AdminRow[]>(`/api/resources?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>(`/api/audit?entityType=Cohort&entityId=${id}`).catch(() => [])
      ]);

    setCohort(cohortData);
    setAllCohorts(cohortRows);
    setSessions(sessionRows);
    setRegistrations(registrationRows);
    setParticipants(participantRows);
    setAllParticipants(allParticipantRows);
    setCommunications(communicationRows);
    setTemplates(templateRows);
    setPayments(paymentRows.filter((payment) => payment.cohortId === id));
    setInvoiceDrafts(invoiceRows);
    setDistribution(distributionData);
    setTasks(taskRows);
    setResources(resourceRows);
    setActivity(activityRows);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [id, notifyError]);

  useEffect(() => {
    if (!compareCohortId) {
      setCompareRegistrations([]);
      return;
    }

    adminApi<AdminRow[]>(`/api/cohorts/${compareCohortId}/registrations`)
      .then(setCompareRegistrations)
      .catch((error) => notifyError(error.message));
  }, [compareCohortId, notifyError]);

  useEffect(() => {
    if (!registrationDetail?.primaryContactEmail) {
      setRegistrationThread([]);
      return;
    }

    setRegistrationThreadLoading(true);
    adminApi<AdminRow[]>(`/api/communications/thread?email=${encodeURIComponent(registrationDetail.primaryContactEmail)}`)
      .then(setRegistrationThread)
      .catch((error) => notifyError(error.message))
      .finally(() => setRegistrationThreadLoading(false));
  }, [registrationDetail?.primaryContactEmail, notifyError]);

  const totals = useMemo(() => {
    const totalAmount = registrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0);
    const paidAmount = payments
      .filter((payment) => payment.status === "PAID")
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
    const pendingAmount = payments
      .filter((payment) => ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
    const participantSeats = registrations.reduce((sum, registration) => sum + Number(registration.participantCount ?? 0), 0);
    const rosterComplete = registrations.filter((registration) => registration.participantListStatus === "COMPLETE").length;
    const openPaymentFollowUps = tasks.filter((task) => task.status !== "COMPLETED" && task.category === "PAYMENT_FOLLOW_UP").length;
    const upcomingSessions = sessions.filter((session) => new Date(session.startTime).getTime() >= Date.now()).length;

    return { totalAmount, paidAmount, pendingAmount, participantSeats, rosterComplete, openPaymentFollowUps, upcomingSessions };
  }, [registrations, payments, sessions, tasks]);

  const revenueRows = useMemo(() => {
    const openAmount = Math.max(totals.totalAmount - totals.paidAmount - totals.pendingAmount, 0);
    return [
      { label: "Paid", amount: totals.paidAmount },
      { label: "Pending", amount: totals.pendingAmount },
      { label: "Open", amount: openAmount }
    ].filter((row) => row.amount > 0);
  }, [totals.paidAmount, totals.pendingAmount, totals.totalAmount]);

  const compareCohort = allCohorts.find((item) => item.id === compareCohortId);
  const filteredRegistrations = useMemo(() => registrations.filter((registration) => {
    const paymentMatch = !registrationPaymentFilter || registration.paymentStatus === registrationPaymentFilter;
    const rosterMatch = !registrationRosterFilter || registration.participantListStatus === registrationRosterFilter;
    return paymentMatch && rosterMatch;
  }), [registrationPaymentFilter, registrationRosterFilter, registrations]);

  const sessionDefaults = useMemo(() => {
    const entries = [
      ["Meeting URL", sessions.map((session) => session.meetingUrl).filter(Boolean)],
      ["Location", sessions.map((session) => session.location).filter(Boolean)],
      ["Timezone", sessions.map((session) => session.timezone).filter(Boolean)]
    ] as Array<[string, unknown[]]>;

    return entries
      .map(([label, values]) => {
        const unique = Array.from(new Set(values.map(String)));
        return unique.length === 1 ? { label, value: unique[0] } : null;
      })
      .filter(Boolean) as Array<{ label: string; value: string }>;
  }, [sessions]);

  const participantHistory = useMemo(() => {
    if (!participantDetail?.email) {
      return [];
    }

    const email = String(participantDetail.email).toLowerCase();
    return allParticipants.filter((participant) => String(participant.email ?? "").toLowerCase() === email && participant.id !== participantDetail.id);
  }, [allParticipants, participantDetail]);

  function sessionEmailStatus(sessionId: string, type: string) {
    const communication = communications.find((item) => item.sessionId === sessionId && item.template?.type === type);
    return communication?.status ?? "NOT_SCHEDULED";
  }

  async function createSessionEmailSchedule(sessionId: string) {
    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "createDefaultSessionCommunications", sessionId }
      });
      notifySuccess("Default session communications created");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendParticipantMessage(participant: AdminRow) {
    const template = templates.find((item) => item.active && item.type === "FOLLOW_UP") ?? templates.find((item) => item.active);

    if (!template) {
      notifyError("No active communication template is available.");
      return;
    }

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToParticipant", participantId: participant.id, templateId: template.id }
      });
      notifySuccess(`Message sent to ${formatProperDisplay(`${participant.firstName} ${participant.lastName}`)}`);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function bulkUpdateParticipants() {
    const ids = Array.from(participantSelection.ids).map(String);

    if (ids.length === 0) {
      notifyError("Select participants first.");
      return;
    }

    try {
      await Promise.all(ids.map((participantId) => adminApi("/api/participants", { method: "PATCH", body: { id: participantId, status: bulkParticipantStatus } })));
      notifySuccess(`${ids.length} participants updated`);
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function updateCohortThumbnail(file?: File) {
    if (!file || !cohort) return;

    setThumbnailUploading(true);
    try {
      const uploaded = await uploadAdminFile<{ url?: string }>(file, "cohort-thumbnail");
      if (!uploaded.url) {
        throw new Error("Thumbnail upload did not return a public URL.");
      }
      await adminApi(`/api/cohorts/${id}`, { method: "PATCH", body: { thumbnailUrl: uploaded.url } });
      notifySuccess("Cohort thumbnail updated");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setThumbnailUploading(false);
    }
  }

  function renderSessionEmailCell(type: string, sessionId: string) {
    const communication = communications.find((item) => item.sessionId === sessionId && item.template?.type === type);
    const scheduled = Boolean(communication);
    return (
      <button
        type="button"
        className={`session-check ${scheduled ? "is-done" : "is-missing"}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!scheduled) void createSessionEmailSchedule(sessionId);
        }}
      title={scheduled ? formatStatusLabel(communication?.status) : "Create scheduled communication"}
    >
      {scheduled ? <CheckCircleOutline /> : <CancelOutlined />}
    </button>
    );
  }

  function renderReadinessIcon(ready: boolean, title: string, onClick?: () => void) {
    return (
      <button
        type="button"
        className={`session-check session-check-icon ${ready ? "is-done" : "is-missing"}`}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        {ready ? <CheckCircleOutline /> : <CancelOutlined />}
      </button>
    );
  }

  const sessionColumns: GridColDef[] = [
    { field: "sessionNumber", headerName: "#", width: 80 },
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "startTime", headerName: "Start", width: 180, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "endTime", headerName: "End", width: 180, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "meetingUrl", headerName: "Meeting URL", flex: 1, minWidth: 200 },
    { field: "location", headerName: "Location", width: 180 },
    { field: "calendarInviteStatus", headerName: "Calendar", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    ...sessionEmailTypes.map((template) => ({
      field: `email-${template.type}`,
      headerName: template.label,
      width: 190,
      sortable: false,
      valueGetter: (_value: unknown, row: AdminRow) => sessionEmailStatus(row.id, template.type),
      renderCell: (params: { row: AdminRow }) => renderSessionEmailCell(template.type, params.row.id)
    })),
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit session", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingSession(params.row); setSessionDialogOpen(true); } },
              {
                label: "Generate ICS",
                icon: <CalendarMonthOutlined fontSize="small" />,
                onClick: async () => {
                  try {
                    await adminApi("/api/calendar", { method: "POST", body: { sessionId: params.row.id, mode: "ics" } });
                    notifySuccess("ICS invite generated");
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              },
              {
                label: "Sync Google Calendar",
                icon: <CalendarMonthOutlined fontSize="small" />,
                onClick: async () => {
                  try {
                    await adminApi("/api/calendar", { method: "POST", body: { sessionId: params.row.id, mode: "google" } });
                    notifySuccess("Google Calendar invite synced");
                    await load();
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              }
            ]}
          />
        </Box>
      )
    }
  ];

  const registrationColumns: GridColDef[] = [
    { field: "primaryContactName", headerName: "Contact", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(row.primaryContactName ?? "") },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "participantCount", headerName: "Participants", width: 120 },
    { field: "participantListStatus", headerName: "Roster", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "paymentStatus", headerName: "Payment", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "invoiceNumber", headerName: "Invoice", width: 130 },
    { field: "purchaseOrderNumber", headerName: "PO", width: 120 },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu actions={[{ label: "Quick view", onClick: () => setRegistrationDetail(params.row) }]} />
        </Box>
      )
    }
  ];

  const participantColumns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(`${row.firstName} ${row.lastName}`) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "message",
      headerName: "Message",
      width: 118,
      sortable: false,
      renderCell: (params) => (
        <Button size="small" variant="outlined" startIcon={<SendOutlined />} onClick={(event) => { event.stopPropagation(); void sendParticipantMessage(params.row); }}>
          Send
        </Button>
      )
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Quick view", onClick: () => setParticipantDetail(params.row) },
              { label: "Send message", icon: <SendOutlined fontSize="small" />, onClick: () => void sendParticipantMessage(params.row) }
            ]}
          />
        </Box>
      )
    }
  ];

  const paymentColumns: GridColDef[] = [
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 220, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? row.registration?.organization?.name ?? "") },
    { field: "billingName", headerName: "Billing / POC Name", width: 190, valueGetter: (_value, row) => formatProperDisplay(row.registration?.billingContactName ?? row.registration?.primaryContactName ?? "") },
    { field: "phone", headerName: "Phone", width: 150, valueGetter: (_value, row) => row.registration?.primaryContactPhone ?? row.organization?.phone ?? "" },
    { field: "address", headerName: "Address", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.registration?.billingAddress ?? row.organization?.addressLine1 ?? "" },
    { field: "method", headerName: "Method", width: 150, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "amount", headerName: "Amount", width: 120, valueFormatter: (value) => money(value) },
    { field: "invoiceNumber", headerName: "Invoice", width: 140 },
    { field: "po", headerName: "PO Number", width: 140, valueGetter: (_value, row) => row.registration?.purchaseOrderNumber ?? "" },
    { field: "lastTouch", headerName: "Last Touch Sent", width: 170, valueGetter: (_value, row) => row.emailSummary?.lastEmailEventAt ?? "", valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "quickBooksSyncStatus", headerName: "QuickBooks Sync", width: 150, renderCell: (params) => <StatusChip value={params.value ?? "NOT_SYNCED"} /> }
  ];

  const taskColumns: GridColDef[] = [
    { field: "title", headerName: "Task", flex: 1, minWidth: 220 },
    { field: "category", headerName: "Category", width: 190, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "priority", headerName: "Priority", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "dueDate", headerName: "Due", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    { field: "ownerName", headerName: "Owner", width: 160 },
    {
      field: "actions",
      headerName: "Actions",
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Button
          variant="outlined"
          color="success"
          onClick={async () => {
            try {
              await adminApi("/api/operations/tasks", { method: "PATCH", body: { id: params.row.id, action: "complete" } });
              notifySuccess("Task completed");
              await load();
            } catch (error) {
              notifyError((error as Error).message);
            }
          }}
        >
          Complete
        </Button>
      )
    }
  ];
  const resourceColumns: GridColDef[] = [
    { field: "title", headerName: "Material", flex: 1, minWidth: 220 },
    { field: "type", headerName: "Type", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "session", headerName: "Session", width: 180, valueGetter: (_value, row) => row.session?.title ?? "Cohort" },
    { field: "visibility", headerName: "Visibility", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "muxPlaybackId", headerName: "Mux playback", width: 170 },
    { field: "url", headerName: "URL", flex: 1, minWidth: 220 }
  ];

  async function saveSession(values: AdminRow) {
    try {
      if (editingSession) {
        await adminApi("/api/sessions", { method: "PATCH", body: { ...values, id: editingSession.id } });
      } else {
        await adminApi(`/api/cohorts/${id}/sessions`, { method: "POST", body: values });
      }
      notifySuccess(editingSession ? "Session updated" : "Session added");
      setEditingSession(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function saveTask(values: AdminRow) {
    try {
      await adminApi(`/api/cohorts/${id}/tasks`, { method: "POST", body: values });
      notifySuccess("Operations task created");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function saveResource(values: AdminRow) {
    try {
      await adminApi("/api/resources", {
        method: "POST",
        body: {
          ...values,
          cohortId: id,
          provider: values.muxPlaybackId ? "mux" : undefined
        }
      });
      notifySuccess("Material added");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  return (
    <PageStack>
      <PageHeader
        title={cohort?.title ?? "Cohort Detail"}
        description="Cohort operations workspace for sessions, registrations, participants, communications, payments, and activity."
      />
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
        {["Overview", "Operations", "Basics", "Registrations", "Participants", "Communications", "Payments", "Distribution", "Activity"].map((label) => (
          <Tab label={label} key={label} />
        ))}
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <div className="cohort-overview-grid">
            {[
              { label: "Registrations", value: registrations.length, helper: "Organizations enrolled", icon: <InsightsOutlined /> },
              { label: "Participant Seats", value: totals.participantSeats, helper: "Confirmed roster capacity", icon: <GroupsOutlined /> },
              { label: "Roster Completion", value: `${totals.rosterComplete}/${registrations.length}`, helper: "Participant lists collected", icon: <CheckCircleOutline /> },
              { label: "Upcoming Sessions", value: totals.upcomingSessions, helper: "Scheduled from today forward", icon: <CalendarMonthOutlined /> }
            ].map((metric) => (
              <article className="cohort-metric-card" key={metric.label}>
                <span className="cohort-metric-icon">{metric.icon}</span>
                <span className="cohort-metric-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <span className="cohort-metric-helper">{metric.helper}</span>
              </article>
            ))}
            <article className="cohort-revenue-card">
              <div className="cohort-revenue-copy">
                <span className="cohort-metric-label">Revenue Snapshot</span>
                <strong>{money(totals.totalAmount)}</strong>
                <div className="cohort-revenue-values">
                  <DetailField label="Paid" value={money(totals.paidAmount)} />
                  <DetailField label="Pending" value={money(totals.pendingAmount)} />
                  <DetailField label="Open" value={money(Math.max(totals.totalAmount - totals.paidAmount - totals.pendingAmount, 0))} />
                </div>
              </div>
              <DonutChart rows={revenueRows} valueKey="amount" labelKey="label" size={132} />
            </article>
          </div>
          <SectionCard
            title="Registration Evolution"
            action={
              <CompactFilterBar>
                <TextField select label="Metric" value={chartMode} onChange={(event) => setChartMode(event.target.value as "count" | "amount")}>
                  <MenuItem value="count">Registrants</MenuItem>
                  <MenuItem value="amount">Revenue</MenuItem>
                </TextField>
                <TextField select label="Compare" value={compareCohortId} onChange={(event) => setCompareCohortId(event.target.value)}>
                  <MenuItem value="">Current cohort only</MenuItem>
                  {allCohorts.filter((item) => item.id !== id).map((item) => (
                    <MenuItem value={item.id} key={item.id}>{item.title}</MenuItem>
                  ))}
                </TextField>
              </CompactFilterBar>
            }
          >
            <RegistrationEvolutionChart rows={registrations} compareRows={compareRegistrations} compareLabel={compareCohort?.title} mode={chartMode} />
          </SectionCard>
        </Stack>
      )}

      {tab === 1 && (
        <SectionCard title="Operations Checklist" action={<Button startIcon={<AddIcon />} onClick={() => setTaskDialogOpen(true)}>Add Task</Button>}>
          <TableShell>
            <AppDataGrid rows={tasks} columns={taskColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
          </TableShell>
          {!loading && tasks.length === 0 && <EmptyState title="No operations tasks" description="Checklist items for participant lists, reminders, resources, recordings, and follow-up will appear here." />}
        </SectionCard>
      )}

      {tab === 2 && (
        <Stack spacing={2}>
          <div className="cohort-basics-grid">
            <SectionCard title="Cohort Basics">
              <div className="cohort-thumbnail-editor">
                <div className="cohort-thumbnail-preview">
                  {cohort?.thumbnailUrl ? <img src={cohort.thumbnailUrl} alt="" /> : <span>No thumbnail</span>}
                </div>
                <div className="quick-view-grid">
                  <DetailField label="Status" value={formatStatusLabel(cohort?.status)} />
                  <DetailField label="Presenter" value={`${cohort?.presenter?.firstName ?? ""} ${cohort?.presenter?.lastName ?? ""}`} proper />
                  <DetailField label="Dates" value={`${cohort?.startDate ? new Date(cohort.startDate).toLocaleDateString() : "-"} - ${cohort?.endDate ? new Date(cohort.endDate).toLocaleDateString() : "-"}`} />
                  <DetailField label="Timezone" value={cohort?.defaultTimezone ?? "-"} />
                  <DetailField label="Slug" value={cohort?.slug ?? "-"} />
                  <DetailField label="Public Registration" value={cohort?.publicRegistrationEnabled ? "Enabled" : "Off"} />
                </div>
                <div className="action-group" style={{ justifyContent: "flex-start" }}>
                  <Button component="label" variant="outlined" disabled={thumbnailUploading}>
                    {thumbnailUploading ? "Uploading" : "Upload Thumbnail"}
                    <input type="file" accept="image/*" hidden onChange={(event: any) => void updateCohortThumbnail(event.currentTarget.files?.[0])} />
                  </Button>
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Session Defaults">
              {sessionDefaults.length > 0 ? (
                <div className="quick-view-grid">
                  {sessionDefaults.map((item) => (
                    <DetailField key={item.label} label={item.label} value={item.value} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No shared defaults" description="Meeting links, locations, or timezones that repeat across sessions will appear here." />
              )}
            </SectionCard>
          </div>
          <SectionCard title="Sessions" action={<Button startIcon={<AddIcon />} onClick={() => setSessionDialogOpen(true)}>Add Session</Button>}>
            <div className="session-checklist" role="table" aria-label="Session checklist">
              <div className="session-check-row session-check-header" role="row">
                <span>Date</span>
                <span>Session</span>
                <span>Cal</span>
                {sessionEmailTypes.map((template) => <span key={template.type} title={template.label}>{template.label}</span>)}
                <span>Actions</span>
              </div>
              {sessions.map((session) => (
                <div className="session-check-row session-check-row-art" role="row" key={session.id} style={{ "--row-art": cohort?.thumbnailUrl ? `url(${cohort.thumbnailUrl})` : undefined } as any}>
                  <DateBadge value={session.startTime} />
                  <div className="session-title-cell">
                    <strong title={session.title}>{session.sessionNumber}. {session.title}</strong>
                    <span title={session.description}>{session.startTime ? new Date(session.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "No time"} - {session.endTime ? new Date(session.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "No end"}</span>
                  </div>
                  {renderReadinessIcon(session.calendarInviteStatus === "CREATED" || session.calendarInviteStatus === "UPDATED", formatStatusLabel(session.calendarInviteStatus), async () => {
                    try {
                      await adminApi("/api/calendar", { method: "POST", body: { sessionId: session.id, mode: "ics" } });
                      notifySuccess("ICS invite generated");
                      await load();
                    } catch (error) {
                      notifyError((error as Error).message);
                    }
                  })}
                  {sessionEmailTypes.map((template) => (
                    <span key={`${session.id}-${template.type}`}>{renderSessionEmailCell(template.type, session.id)}</span>
                  ))}
                  <RowActionMenu
                    actions={[
                      { label: "Edit session", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingSession(session); setSessionDialogOpen(true); } },
                      {
                        label: "Generate ICS",
                        icon: <CalendarMonthOutlined fontSize="small" />,
                        onClick: async () => {
                          try {
                            await adminApi("/api/calendar", { method: "POST", body: { sessionId: session.id, mode: "ics" } });
                            notifySuccess("ICS invite generated");
                          } catch (error) {
                            notifyError((error as Error).message);
                          }
                        }
                      },
                      {
                        label: "Sync Google Calendar",
                        icon: <CalendarMonthOutlined fontSize="small" />,
                        onClick: async () => {
                          try {
                            await adminApi("/api/calendar", { method: "POST", body: { sessionId: session.id, mode: "google" } });
                            notifySuccess("Google Calendar invite synced");
                            await load();
                          } catch (error) {
                            notifyError((error as Error).message);
                          }
                        }
                      }
                    ]}
                  />
                </div>
              ))}
            </div>
            {!loading && sessions.length === 0 && <EmptyState title="No sessions yet" description="Add sessions to build the cohort schedule." />}
          </SectionCard>
          <SectionCard title="Materials" action={<Button startIcon={<AddIcon />} onClick={() => setResourceDialogOpen(true)}>Add Material</Button>}>
            <TableShell>
              <AppDataGrid rows={resources} columns={resourceColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
            </TableShell>
            {!loading && resources.length === 0 && <EmptyState title="No materials yet" description="Attach recordings, slides, documents, and links that can support sessions and future emails." />}
          </SectionCard>
        </Stack>
      )}

      {tab === 3 && (
        <SectionCard title="Registrations" action={<Button href="/registrations" startIcon={<AddIcon />}>Add/Edit Registration</Button>}>
          <CompactFilterBar resultCount={filteredRegistrations.length}>
            <TextField select label="Payment" value={registrationPaymentFilter} onChange={(event) => setRegistrationPaymentFilter(event.target.value)}>
              <MenuItem value="">All payments</MenuItem>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <TextField select label="Roster" value={registrationRosterFilter} onChange={(event) => setRegistrationRosterFilter(event.target.value)}>
              <MenuItem value="">All rosters</MenuItem>
              {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </CompactFilterBar>
          <TableShell>
            <AppDataGrid
              rows={filteredRegistrations}
              columns={registrationColumns}
              loading={loading}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              onRowClick={(params) => setRegistrationDetail(params.row)}
            />
          </TableShell>
          {!loading && filteredRegistrations.length === 0 && <EmptyState title="No registrations found" description="Registrations for this cohort will appear here, or adjust payment and roster filters." />}
        </SectionCard>
      )}

      {tab === 4 && (
        <SectionCard title="Participants" action={<Button href="/participants" startIcon={<AddIcon />}>Add/Edit Participant</Button>}>
          <div className="participant-bulk-bar">
            <span>{participantSelection.ids.size} selected</span>
            <TextField select label="Bulk status" value={bulkParticipantStatus} onChange={(event) => setBulkParticipantStatus(event.target.value)}>
              {participantStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button type="button" variant="outlined" onClick={bulkUpdateParticipants}>Apply Status</Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<SendOutlined />}
              disabled={participantSelection.ids.size === 0}
              onClick={() => {
                const selected = participants.filter((participant) => participantSelection.ids.has(participant.id));
                void Promise.all(selected.map((participant) => sendParticipantMessage(participant)));
              }}
            >
              Message Selected
            </Button>
          </div>
          <TableShell>
            <AppDataGrid
              rows={participants}
              columns={participantColumns}
              loading={loading}
              checkboxSelection
              rowSelectionModel={participantSelection}
              onRowSelectionModelChange={setParticipantSelection}
              onRowClick={(params) => setParticipantDetail(params.row)}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            />
          </TableShell>
          {!loading && participants.length === 0 && <EmptyState title="No participants yet" description="Participants attached to this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 5 && (
        <SectionCard title="Communications">
          <List dense>
            {communications.map((communication) => (
              <ListItem key={communication.id} divider>
                <ListItemText primary={communication.subject} secondary={communication.scheduledFor ? new Date(communication.scheduledFor).toLocaleString() : "Draft"} />
                <StatusChip value={communication.status} />
              </ListItem>
            ))}
          </List>
          {!loading && communications.length === 0 && <EmptyState title="No communications yet" description="Scheduled and sent communications for this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 6 && (
        <SectionCard title="Payments">
          <div className="cohort-finance-strip">
            <DetailField label="Invoice Drafts" value={invoiceDrafts.length} />
            <DetailField label="Paid" value={money(totals.paidAmount)} />
            <DetailField label="Pending" value={money(totals.pendingAmount)} />
          </div>
          <TableShell>
            <AppDataGrid
              rows={payments}
              columns={paymentColumns}
              loading={loading}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              onRowClick={(params) => setPaymentDetail(params.row)}
            />
          </TableShell>
          {!loading && payments.length === 0 && <EmptyState title="No payments yet" description="Payment records tied to this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 7 && (
        <Stack spacing={2}>
          <SectionCard title="Distribution Snapshot">
            {distribution ? (
              <div className="distribution-grid">
                <article className="cohort-revenue-card distribution-card-main">
                  <div className="cohort-revenue-copy">
                    <span className="cohort-metric-label">Project Return</span>
                    <strong>{money(distribution.totals?.projectReturn)}</strong>
                    <div className="cohort-revenue-values">
                      <DetailField label="Sold" value={money(distribution.totals?.soldAmount)} />
                      <DetailField label="Paid In" value={money(distribution.totals?.paidAmount)} />
                      <DetailField label="Return %" value={`${distribution.totals?.returnPercent ?? 0}%`} />
                    </div>
                  </div>
                  <DonutChart rows={[
                    { label: "RPD", amount: distribution.totals?.commissionAmount ?? 0 },
                    { label: "TL", amount: distribution.totals?.tlShareAmount ?? 0 }
                  ]} valueKey="amount" labelKey="label" size={132} />
                </article>
                {[
                  ["RPD Commission", `${distribution.distribution?.commissionPercent ?? 30}% · ${money(distribution.totals?.commissionAmount)}`],
                  ["TL Share", `${distribution.distribution?.tlSharePercent ?? 70}% · ${money(distribution.totals?.tlShareAmount)}`],
                  ["TL Payout Due", money(distribution.totals?.tlPayoutDue)],
                  ["Paid Out", money(distribution.totals?.payoutMade)],
                  ["Pending Payout", money(distribution.totals?.pendingPayout)],
                  ["Payment Ratio", `${Math.round(Number(distribution.totals?.paymentRatio ?? 0) * 100)}%`]
                ].map(([label, value]) => (
                  <article className="cohort-metric-card" key={label}>
                    <span className="cohort-metric-label">{label}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Distribution unavailable" description="Distribution data will appear when this cohort can be loaded." />
            )}
          </SectionCard>
        </Stack>
      )}

      {tab === 8 && (
        <SectionCard title="Activity">
          <List dense>
            {activity.map((event) => (
              <ListItem key={event.id} divider>
                <ListItemText primary={`${event.action} ${event.entityType}`} secondary={`${event.description ?? ""} ${new Date(event.createdAt).toLocaleString()}`} />
              </ListItem>
            ))}
          </List>
          {!loading && activity.length === 0 && <EmptyState title="No activity yet" description="Audit events for this cohort will appear here." />}
        </SectionCard>
      )}

      <MutationDialog
        title={editingSession ? "Edit Session" : "Add Session"}
        open={sessionDialogOpen}
        fields={sessionFields}
        initialValues={editingSession ?? { timezone: cohort?.defaultTimezone ?? "America/New_York", sessionNumber: sessions.length + 1 }}
        onClose={() => { setSessionDialogOpen(false); setEditingSession(null); }}
        onSubmit={saveSession}
      />
      <MutationDialog
        title="Add Operations Task"
        open={taskDialogOpen}
        fields={taskFields}
        initialValues={{ category: "OTHER", priority: "MEDIUM" }}
        onClose={() => setTaskDialogOpen(false)}
        onSubmit={saveTask}
      />
      <MutationDialog
        title="Add Material"
        open={resourceDialogOpen}
        fields={resourceFields}
        initialValues={{ type: "LINK", visibility: "ADMIN_ONLY" }}
        onClose={() => setResourceDialogOpen(false)}
        onSubmit={saveResource}
      />
      <PaymentDetailDialog
        payment={paymentDetail}
        cohortId={id}
        templates={templates}
        open={Boolean(paymentDetail)}
        onClose={() => setPaymentDetail(null)}
        onChanged={async () => {
          notifySuccess("Payment updated");
          await load();
        }}
        onError={notifyError}
      />
      <QuickViewDrawer
        title="Registration Detail"
        open={Boolean(registrationDetail)}
        onClose={() => setRegistrationDetail(null)}
        actions={<Button href="/registrations" variant="outlined">Open Registrations</Button>}
      >
        {registrationDetail && (
          <>
            <div className="quick-view-grid">
              <DetailField label="Contact" value={registrationDetail.primaryContactName} proper />
              <DetailField label="Email" value={registrationDetail.primaryContactEmail} />
              <DetailField label="Phone" value={registrationDetail.primaryContactPhone} />
              <DetailField label="Organization" value={registrationDetail.organization?.name} proper />
              <DetailField label="Participants" value={registrationDetail.participantCount} />
              <DetailField label="Total" value={money(registrationDetail.totalAmount)} />
              <DetailField label="Payment" value={formatStatusLabel(registrationDetail.paymentStatus)} />
              <DetailField label="Roster" value={formatStatusLabel(registrationDetail.participantListStatus)} />
              <DetailField label="Supporting Docs" value={formatStatusLabel(registrationDetail.supportingDocumentStatus)} />
              <DetailField label="Invoice" value={registrationDetail.invoiceNumber} />
              <DetailField label="PO" value={registrationDetail.purchaseOrderNumber} />
              <DetailField label="Source" value={registrationDetail.source} />
            </div>
            <SectionCard title="Notes">
              <Typography color="text.secondary">{registrationDetail.notes ?? "No notes captured yet."}</Typography>
            </SectionCard>
            <SectionCard title="POC Communication History">
              {registrationThreadLoading ? (
                <Typography color="text.secondary">Loading communication history...</Typography>
              ) : registrationThread.length > 0 ? (
                <div className="quick-view-list">
                  {registrationThread.map((communication) => (
                    <div className="quick-view-list-row" key={communication.id}>
                      <div>
                        <strong>{communication.subject ?? "Email event"}</strong>
                        <span>
                          {communication.cohort?.title ?? communication.communication?.cohort?.title ?? "Mission Control"} · {formatStatusLabel(communication.status)}
                          {communication.emailSummary?.lastEmailEvent ? ` · ${formatStatusLabel(communication.emailSummary.lastEmailEvent)}` : ""}
                        </span>
                        {communication.attachments?.length > 0 && <span>{communication.attachments.length} attachment{communication.attachments.length === 1 ? "" : "s"}</span>}
                      </div>
                      <DateBadge value={communication.sentAt ?? communication.createdAt} />
                    </div>
                  ))}
                </div>
              ) : (
                <Typography color="text.secondary">No outbound email history found for this POC yet.</Typography>
              )}
            </SectionCard>
          </>
        )}
      </QuickViewDrawer>
      <QuickViewDrawer
        title="Participant Detail"
        open={Boolean(participantDetail)}
        onClose={() => setParticipantDetail(null)}
        actions={participantDetail && <Button startIcon={<SendOutlined />} onClick={() => void sendParticipantMessage(participantDetail)}>Send Message</Button>}
      >
        {participantDetail && (
          <>
            <div className="quick-view-grid">
              <DetailField label="Participant" value={`${participantDetail.firstName ?? ""} ${participantDetail.lastName ?? ""}`} proper />
              <DetailField label="Email" value={participantDetail.email} />
              <DetailField label="Phone" value={participantDetail.phone} />
              <DetailField label="Title" value={participantDetail.title} />
              <DetailField label="Status" value={formatStatusLabel(participantDetail.status)} />
              <DetailField label="Certificate" value={participantDetail.certificateIssued ? "Issued" : "Not issued"} />
              <DetailField label="Organization" value={participantDetail.organization?.name} proper />
              <DetailField label="Registration POC" value={participantDetail.registration?.primaryContactName} proper />
              <DetailField label="Payment" value={formatStatusLabel(participantDetail.registration?.paymentStatus)} />
              <DetailField label="Amount" value={money(participantDetail.registration?.totalAmount)} />
              <DetailField label="Last Email" value={participantDetail.emailSummary?.lastEmailEvent ?? "-"} />
              <DetailField label="Last Email Sent" value={participantDetail.emailSummary?.lastEmailEventAt ? new Date(participantDetail.emailSummary.lastEmailEventAt).toLocaleString() : "-"} />
            </div>
            <SectionCard title="Participation History">
              {participantHistory.length > 0 ? (
                <div className="quick-view-list">
                  {participantHistory.map((participant) => (
                    <div className="quick-view-list-row" key={participant.id}>
                      <div>
                        <strong>{participant.cohort?.title ?? "Cohort"}</strong>
                        <span>{participant.organization?.name ?? "Organization"} · {formatStatusLabel(participant.status)}</span>
                      </div>
                      <DateBadge value={participant.createdAt} />
                    </div>
                  ))}
                </div>
              ) : (
                <Typography color="text.secondary">No other cohort history found for this email.</Typography>
              )}
            </SectionCard>
          </>
        )}
      </QuickViewDrawer>
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
