"use client";

import AddIcon from "@mui/icons-material/Add";
import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tab,
  Tabs,
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

export function CohortDetailClient({ id }: { id: string }) {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cohort, setCohort] = useState<AdminRow | null>(null);
  const [sessions, setSessions] = useState<AdminRow[]>([]);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [participants, setParticipants] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [tasks, setTasks] = useState<AdminRow[]>([]);
  const [activity, setActivity] = useState<AdminRow[]>([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AdminRow | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohortData, sessionRows, registrationRows, participantRows, communicationRows, paymentRows, taskRows, activityRows] =
      await Promise.all([
        adminApi<AdminRow>(`/api/cohorts/${id}`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/sessions`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/registrations`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/participants`),
        adminApi<AdminRow[]>(`/api/communications?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>("/api/payments").catch(() => []),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/tasks`).catch(() => []),
        adminApi<AdminRow[]>(`/api/audit?entityType=Cohort&entityId=${id}`).catch(() => [])
      ]);

    setCohort(cohortData);
    setSessions(sessionRows);
    setRegistrations(registrationRows);
    setParticipants(participantRows);
    setCommunications(communicationRows);
    setPayments(paymentRows.filter((payment) => payment.cohortId === id));
    setTasks(taskRows);
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
    const pendingAmount = payments
      .filter((payment) => ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    return { totalAmount, pendingAmount };
  }, [registrations, payments]);

  const sessionColumns: GridColDef[] = [
    { field: "sessionNumber", headerName: "#", width: 80 },
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "startTime", headerName: "Start", width: 180, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "endTime", headerName: "End", width: 180, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    { field: "meetingUrl", headerName: "Meeting URL", flex: 1, minWidth: 200 },
    { field: "location", headerName: "Location", width: 180 },
    { field: "calendarInviteStatus", headerName: "Calendar", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 220,
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
        <Grid container spacing={2}>
          {[
            ["Status", <StatusChip key="status" value={cohort?.status} />],
            ["Presenter", `${cohort?.presenter?.firstName ?? ""} ${cohort?.presenter?.lastName ?? ""}`],
            ["Registration Window", `${cohort?.registrationOpenDate ? new Date(cohort.registrationOpenDate).toLocaleDateString() : "-"} - ${cohort?.registrationCloseDate ? new Date(cohort.registrationCloseDate).toLocaleDateString() : "-"}`],
            ["Session Dates", `${cohort?.startDate ? new Date(cohort.startDate).toLocaleDateString() : "-"} - ${cohort?.endDate ? new Date(cohort.endDate).toLocaleDateString() : "-"}`],
            ["Total Participants", participants.length],
            ["Total Amount", `$${totals.totalAmount.toLocaleString()}`],
            ["Pending Amount", `$${totals.pendingAmount.toLocaleString()}`]
          ].map(([label, value]) => (
            <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={String(label)}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" variant="body2">{label}</Typography>
                  <Typography variant="h3" sx={{ mt: 1 }}>{value}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
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
        <SectionCard title="Resources">
          <Typography color="text.secondary">Resource upload and visibility management are reserved for Prompt 3.</Typography>
        </SectionCard>
      )}

      {tab === 7 && (
        <SectionCard title="Payments">
          <List dense>
            {payments.map((payment) => (
              <ListItem key={payment.id} divider>
                <ListItemText primary={payment.invoiceNumber ?? "Payment"} secondary={`$${Number(payment.amount ?? 0).toLocaleString()}`} />
                <StatusChip value={payment.status} />
              </ListItem>
            ))}
          </List>
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
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
