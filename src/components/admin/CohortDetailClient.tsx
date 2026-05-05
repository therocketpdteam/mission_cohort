"use client";

import AddIcon from "@mui/icons-material/Add";
import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
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
} from "@mui/material";
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
    ].map((value) => ({ label: value.replace(/_/g, " "), value })),
    required: true
  },
  { name: "priority", label: "Priority", type: "select", options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => ({ label: value, value })) },
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
    options: ["VIDEO", "SLIDES", "PDF", "LINK", "WORKBOOK", "OTHER"].map((value) => ({ label: value, value })),
    required: true
  },
  { name: "url", label: "URL" },
  { name: "muxAssetId", label: "Mux asset ID" },
  { name: "muxPlaybackId", label: "Mux playback ID" },
  {
    name: "visibility",
    label: "Visibility",
    type: "select",
    options: ["ADMIN_ONLY", "PARTICIPANTS", "PUBLIC_LINK"].map((value) => ({ label: value.replace(/_/g, " "), value })),
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

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function RegistrationEvolutionChart({ rows, mode }: { rows: AdminRow[]; mode: "count" | "amount" }) {
  const points = useMemo(() => {
    const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let cumulative = 0;
    return sorted.map((registration) => {
      cumulative += mode === "count" ? Number(registration.participantCount ?? 0) : Number(registration.totalAmount ?? 0);
      return { label: new Date(registration.createdAt).toLocaleDateString(), value: cumulative };
    });
  }, [mode, rows]);
  const max = Math.max(...points.map((point) => point.value), 1);
  const width = 720;
  const height = 220;
  const innerWidth = width - 64;
  const innerHeight = height - 48;
  const path = points
    .map((point, index) => {
      const x = 40 + (points.length <= 1 ? innerWidth : (index / (points.length - 1)) * innerWidth);
      const y = 16 + innerHeight - (point.value / max) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  if (points.length === 0) {
    return <EmptyState title="No registration trend yet" description="Registrations will draw the cohort evolution chart here." />;
  }

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <Box component="svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Registration evolution chart" sx={{ width: "100%", minWidth: 520 }}>
        <line x1="40" y1={height - 32} x2={width - 24} y2={height - 32} stroke="#D7DEE8" />
        <line x1="40" y1="16" x2="40" y2={height - 32} stroke="#D7DEE8" />
        <path d={path} fill="none" stroke="#057C8E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = 40 + (points.length <= 1 ? innerWidth : (index / (points.length - 1)) * innerWidth);
          const y = 16 + innerHeight - (point.value / max) * innerHeight;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="5" fill="#D99A2B" />;
        })}
        <text x="40" y="14" fill="#4A5568" fontSize="13">{mode === "count" ? `${max} seats` : money(max)}</text>
        <text x="40" y={height - 8} fill="#4A5568" fontSize="13">{points[0]?.label}</text>
        <text x={width - 150} y={height - 8} fill="#4A5568" fontSize="13">{points.at(-1)?.label}</text>
      </Box>
    </Box>
  );
}

function PaymentDetailDialog({
  payment,
  templates,
  open,
  onClose,
  onChanged,
  onError
}: {
  payment: AdminRow | null;
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
                  {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{value.replace(/_/g, " ")}</MenuItem>)}
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
          <Button variant="outlined" onClick={() => setDraftOpen(true)}>Generate Invoice Draft</Button>
          <Button variant="outlined" onClick={sendReminder}>Send Reminder</Button>
          <Button variant="outlined" onClick={onClose}>Close</Button>
          <Button onClick={updatePayment}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={draftOpen} onClose={() => setDraftOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Invoice Draft Placeholder</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            Invoice generation is ready for the next pass. Once the RocketPD invoice template is added, this action can generate a draft from the registration and payment fields.
          </Typography>
        </DialogContent>
        <DialogActions>
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
  const [sessions, setSessions] = useState<AdminRow[]>([]);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [participants, setParticipants] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [tasks, setTasks] = useState<AdminRow[]>([]);
  const [resources, setResources] = useState<AdminRow[]>([]);
  const [activity, setActivity] = useState<AdminRow[]>([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AdminRow | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [chartMode, setChartMode] = useState<"count" | "amount">("count");
  const [paymentDetail, setPaymentDetail] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohortData, sessionRows, registrationRows, participantRows, communicationRows, templateRows, paymentRows, taskRows, resourceRows, activityRows] =
      await Promise.all([
        adminApi<AdminRow>(`/api/cohorts/${id}`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/sessions`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/registrations`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/participants`),
        adminApi<AdminRow[]>(`/api/communications?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>("/api/communications/templates").catch(() => []),
        adminApi<AdminRow[]>("/api/payments").catch(() => []),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/tasks`).catch(() => []),
        adminApi<AdminRow[]>(`/api/resources?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>(`/api/audit?entityType=Cohort&entityId=${id}`).catch(() => [])
      ]);

    setCohort(cohortData);
    setSessions(sessionRows);
    setRegistrations(registrationRows);
    setParticipants(participantRows);
    setCommunications(communicationRows);
    setTemplates(templateRows);
    setPayments(paymentRows.filter((payment) => payment.cohortId === id));
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

  function renderSessionEmailCell(type: string, sessionId: string) {
    const communication = communications.find((item) => item.sessionId === sessionId && item.template?.type === type);
    return (
      <Stack direction="row" spacing={0.75} alignItems="center">
        <StatusChip value={communication?.status ?? "NOT_SCHEDULED"} />
        {!communication && (
          <Button size="small" variant="text" onClick={() => createSessionEmailSchedule(sessionId)}>
            Create
          </Button>
        )}
      </Stack>
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
      width: 320,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditingSession(params.row); setSessionDialogOpen(true); }}>
            Edit
          </Button>
          <Button
            variant="outlined"
            startIcon={<CalendarMonthOutlined />}
            onClick={async () => {
              try {
                await adminApi("/api/calendar", { method: "POST", body: { sessionId: params.row.id, mode: "ics" } });
                notifySuccess("ICS invite generated");
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            ICS
          </Button>
          <Button
            variant="outlined"
            startIcon={<CalendarMonthOutlined />}
            onClick={async () => {
              try {
                await adminApi("/api/calendar", { method: "POST", body: { sessionId: params.row.id, mode: "google" } });
                notifySuccess("Google Calendar invite synced");
                await load();
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            Google
          </Button>
        </Stack>
      )
    }
  ];

  const registrationColumns: GridColDef[] = [
    { field: "primaryContactName", headerName: "Contact", flex: 1, minWidth: 180 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => row.organization?.name ?? "" },
    { field: "participantCount", headerName: "Participants", width: 120 },
    { field: "participantListStatus", headerName: "Roster", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "paymentStatus", headerName: "Payment", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "supportingDocumentStatus", headerName: "Docs", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "invoiceNumber", headerName: "Invoice", width: 140 },
    { field: "purchaseOrderNumber", headerName: "PO", width: 130 },
    { field: "quickBooksInvoiceRef", headerName: "QB invoice", width: 150 }
  ];

  const participantColumns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => `${row.firstName} ${row.lastName}` },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => row.organization?.name ?? "" },
    { field: "attendanceStatus", headerName: "Attendance", width: 150, renderCell: (params) => <StatusChip value={params.value} /> }
  ];

  const paymentColumns: GridColDef[] = [
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.organization?.name ?? row.registration?.organization?.name ?? "" },
    { field: "billingName", headerName: "Billing / POC Name", width: 190, valueGetter: (_value, row) => row.registration?.billingContactName ?? row.registration?.primaryContactName ?? "" },
    { field: "phone", headerName: "Phone", width: 150, valueGetter: (_value, row) => row.registration?.primaryContactPhone ?? row.organization?.phone ?? "" },
    { field: "address", headerName: "Address", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.registration?.billingAddress ?? row.organization?.addressLine1 ?? "" },
    { field: "method", headerName: "Method", width: 150, valueFormatter: (value) => String(value ?? "").replace(/_/g, " ") },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "amount", headerName: "Amount", width: 120, valueFormatter: (value) => money(value) },
    { field: "invoiceNumber", headerName: "Invoice", width: 140 },
    { field: "po", headerName: "PO Number", width: 140, valueGetter: (_value, row) => row.registration?.purchaseOrderNumber ?? "" },
    { field: "lastTouch", headerName: "Last Touch Sent", width: 170, valueGetter: (_value, row) => row.emailSummary?.lastEmailEventAt ?? "", valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "quickBooksSyncStatus", headerName: "QuickBooks Sync", width: 150, renderCell: (params) => <StatusChip value={params.value ?? "NOT_SYNCED"} /> }
  ];

  const taskColumns: GridColDef[] = [
    { field: "title", headerName: "Task", flex: 1, minWidth: 220 },
    { field: "category", headerName: "Category", width: 190, valueFormatter: (value) => String(value ?? "").replace(/_/g, " ") },
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
    { field: "title", headerName: "Resource", flex: 1, minWidth: 220 },
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
      notifySuccess("Resource added");
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
        {["Overview", "Operations", "Sessions", "Registrations", "Participants", "Communications", "Resources", "Payments", "Activity"].map((label) => (
          <Tab label={label} key={label} />
        ))}
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            {[
              ["Registrations", registrations.length],
              ["Participant Seats", totals.participantSeats],
              ["Roster Completion", `${totals.rosterComplete}/${registrations.length}`],
              ["Total Revenue", money(totals.totalAmount)],
              ["Paid Amount", money(totals.paidAmount)],
              ["Pending Amount", money(totals.pendingAmount)],
              ["Payment Follow-Ups", totals.openPaymentFollowUps],
              ["Upcoming Sessions", totals.upcomingSessions]
            ].map(([label, value]) => (
              <Grid size={{ xs: 12, sm: 6, md: 3, xl: 1.5 }} key={String(label)}>
                <Card sx={{ height: "100%" }}>
                  <CardContent>
                    <Typography color="text.secondary" variant="body2">{label}</Typography>
                    <Typography variant="h4" sx={{ mt: 1 }}>{value}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <SectionCard
            title="Registration Evolution"
            action={
              <Stack direction="row" spacing={1}>
                <Button size="small" variant={chartMode === "count" ? "contained" : "outlined"} onClick={() => setChartMode("count")}>Registrants #</Button>
                <Button size="small" variant={chartMode === "amount" ? "contained" : "outlined"} onClick={() => setChartMode("amount")}>$$</Button>
              </Stack>
            }
          >
            <RegistrationEvolutionChart rows={registrations} mode={chartMode} />
          </SectionCard>
          <SectionCard title="Cohort Snapshot">
            <Grid container spacing={2}>
              {[
                ["Status", <StatusChip key="status" value={cohort?.status} />],
                ["Presenter", `${cohort?.presenter?.firstName ?? ""} ${cohort?.presenter?.lastName ?? ""}`],
                ["Session Dates", `${cohort?.startDate ? new Date(cohort.startDate).toLocaleDateString() : "-"} - ${cohort?.endDate ? new Date(cohort.endDate).toLocaleDateString() : "-"}`],
                ["Timezone", cohort?.defaultTimezone ?? "-"]
              ].map(([label, value]) => (
                <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={String(label)}>
                  <Typography color="text.secondary" variant="body2">{label}</Typography>
                  <Typography sx={{ mt: 0.5 }}>{value}</Typography>
                </Grid>
              ))}
            </Grid>
          </SectionCard>
        </Stack>
      )}

      {tab === 1 && (
        <SectionCard title="Operations Checklist" action={<Button startIcon={<AddIcon />} onClick={() => setTaskDialogOpen(true)}>Add Task</Button>}>
          <TableShell>
            <DataGrid rows={tasks} columns={taskColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
          </TableShell>
          {!loading && tasks.length === 0 && <EmptyState title="No operations tasks" description="Checklist items for participant lists, reminders, resources, recordings, and follow-up will appear here." />}
        </SectionCard>
      )}

      {tab === 2 && (
        <SectionCard title="Sessions" action={<Button startIcon={<AddIcon />} onClick={() => setSessionDialogOpen(true)}>Add Session</Button>}>
          <TableShell>
            <DataGrid rows={sessions} columns={sessionColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
          </TableShell>
          {!loading && sessions.length === 0 && <EmptyState title="No sessions yet" description="Add sessions to build the cohort schedule." />}
        </SectionCard>
      )}

      {tab === 3 && (
        <SectionCard title="Registrations" action={<Button href="/registrations" startIcon={<AddIcon />}>Add/Edit Registration</Button>}>
          <TableShell>
            <DataGrid rows={registrations} columns={registrationColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
          </TableShell>
          {!loading && registrations.length === 0 && <EmptyState title="No registrations yet" description="Registrations for this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 4 && (
        <SectionCard title="Participants" action={<Button href="/participants" startIcon={<AddIcon />}>Add/Edit Participant</Button>}>
          <TableShell>
            <DataGrid rows={participants} columns={participantColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
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
        <SectionCard title="Resources" action={<Button startIcon={<AddIcon />} onClick={() => setResourceDialogOpen(true)}>Add Resource</Button>}>
          <TableShell>
            <DataGrid rows={resources} columns={resourceColumns} loading={loading} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
          </TableShell>
          {!loading && resources.length === 0 && <EmptyState title="No resources yet" description="Attach Mux recordings, slides, documents, and session links here." />}
          {resources.filter((resource) => resource.muxPlaybackId).map((resource) => (
            <Box key={resource.id} sx={{ mt: 2, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
              <Box component="video" title={resource.title} controls src={`https://stream.mux.com/${resource.muxPlaybackId}.m3u8`} sx={{ width: "100%", aspectRatio: "16 / 9", bgcolor: "#0B1020" }} />
            </Box>
          ))}
        </SectionCard>
      )}

      {tab === 7 && (
        <SectionCard title="Payments">
          <TableShell>
            <DataGrid
              rows={payments}
              columns={paymentColumns}
              loading={loading}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              disableRowSelectionOnClick
              rowHeight={46}
              sx={{ "& .MuiDataGrid-cell": { py: 0.5 } }}
              onRowClick={(params) => setPaymentDetail(params.row)}
            />
          </TableShell>
          {!loading && payments.length === 0 && <EmptyState title="No payments yet" description="Payment records tied to this cohort will appear here." />}
        </SectionCard>
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
        title="Add Resource"
        open={resourceDialogOpen}
        fields={resourceFields}
        initialValues={{ type: "LINK", visibility: "ADMIN_ONLY" }}
        onClose={() => setResourceDialogOpen(false)}
        onSubmit={saveResource}
      />
      <PaymentDetailDialog
        payment={paymentDetail}
        templates={templates}
        open={Boolean(paymentDetail)}
        onClose={() => setPaymentDetail(null)}
        onChanged={async () => {
          notifySuccess("Payment updated");
          await load();
        }}
        onError={notifyError}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
