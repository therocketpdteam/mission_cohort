"use client";

import AddIcon from "@mui/icons-material/Add";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatHumanLabel, formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, EmptyState, LoadingState, MetadataPill, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

const metricLabels: ReadonlyArray<[string, string, Route]> = [
  ["activeCohorts", "Active Cohorts", "/cohorts"],
  ["upcomingSessions", "Upcoming Sessions", "/cohorts"],
  ["openRegistrations", "Open Registrations", "/registrations"],
  ["totalParticipants", "Total Participants", "/participants"],
  ["pendingPayments", "Pending Payments", "/registrations"],
  ["scheduledCommunications", "Scheduled Communications", "/communications"],
  ["openOperationsTasks", "Open Operations Tasks", "/cohorts"]
];

const quickActions: ReadonlyArray<[string, Route]> = [
  ["Create Cohort", "/cohorts"],
  ["Add Registration", "/registrations"],
  ["Create Email Template", "/communications"]
];

function DashboardPanel({ title, href, actionLabel, children }: { title: string; href: Route; actionLabel: string; children: ReactNode }) {
  return (
    <SectionCard
      title={title}
      action={<Button component={Link} href={href} size="small" variant="outlined">{actionLabel}</Button>}
      sx={{ height: "100%" }}
      contentSx={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {children}
      </Box>
    </SectionCard>
  );
}

function shortDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function timeText(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function DashboardClient() {
  const [data, setData] = useState<AdminRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [readinessCohort, setReadinessCohort] = useState<AdminRow | null>(null);
  const [sessionView, setSessionView] = useState("list");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>("/api/admin-dashboard")
      .then(setData)
      .catch((error) => notifyError(error.message))
      .finally(() => setLoading(false));
  }, [notifyError]);

  const readinessRows = useMemo(() => {
    const taskRows = (data?.openOperationsTasks ?? []).filter((task: AdminRow) => task.category !== "CALENDAR_INVITE");
    const grouped = new Map<string, AdminRow>();

    for (const cohort of data?.cohortsNeedingAttention ?? []) {
      grouped.set(cohort.id, {
        cohort,
        tasks: [],
        nextSession: (data?.upcomingSessions ?? []).find((session: AdminRow) => session.cohortId === cohort.id),
        registrationCount: cohort._count?.registrations ?? 0,
        participantCount: cohort._count?.participants ?? 0
      });
    }

    for (const task of taskRows) {
      const cohortId = task.cohortId ?? task.cohort?.id ?? "operations";
      const current = grouped.get(cohortId) ?? {
        cohort: task.cohort ?? { id: cohortId, title: "Operations" },
        tasks: [],
        nextSession: (data?.upcomingSessions ?? []).find((session: AdminRow) => session.cohortId === cohortId),
        registrationCount: 0,
        participantCount: 0
      };
      current.tasks = [...current.tasks, task];
      grouped.set(cohortId, current);
    }

    return Array.from(grouped.values()).slice(0, 6);
  }, [data]);

  const filteredPayments = useMemo(
    () => (data?.paymentStatusSnapshot ?? []).filter((payment: AdminRow) => paymentFilter === "ALL" || payment.status === paymentFilter),
    [data, paymentFilter]
  );
  const maxPaymentAmount = Math.max(...filteredPayments.map((payment: AdminRow) => Number(payment._sum?.amount ?? 0)), 1);

  return (
    <PageStack>
      <PageHeader
        title="Dashboard"
        description="Operational snapshot for cohorts, registrations, sessions, payments, and communications."
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(7, minmax(0, 1fr))" },
          gap: 2,
          alignItems: "stretch"
        }}
      >
        {metricLabels.map(([key, label, href]) => (
          <Box key={key} sx={{ minWidth: 0 }}>
            <Link href={href}>
              <Card
                sx={{
                  display: "flex",
                  height: "100%",
                  transition: "border-color 120ms ease, transform 120ms ease",
                  "&:hover": { borderColor: "primary.main", transform: "translateY(-1px)" }
                }}
              >
                <CardContent sx={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 132 }}>
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="h1" sx={{ mt: 1 }}>
                    {data?.metrics?.[key] ?? "-"}
                  </Typography>
                </CardContent>
              </Card>
            </Link>
          </Box>
        ))}
      </Box>

      {loading && <LoadingState label="Loading dashboard" />}

      <SectionCard title="Quick Actions">
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {quickActions.map(([label, href]) => (
            <Button component={Link} href={href} startIcon={<AddIcon />} key={label}>
              {label}
            </Button>
          ))}
        </Stack>
      </SectionCard>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Open Operations Tasks" href="/cohorts" actionLabel="View cohorts">
            <List dense>
              {readinessRows.map((row: AdminRow) => (
                <ListItem key={row.cohort.id} divider secondaryAction={<Button size="small" variant="outlined" onClick={() => setReadinessCohort(row)}>Details</Button>}>
                  <ListItemText
                    primary={row.cohort.title}
                    secondary={`${row.tasks.length} open task${row.tasks.length === 1 ? "" : "s"} • ${row.registrationCount} registrations • ${row.nextSession ? `Next ${shortDate(row.nextSession.startTime)}` : "No upcoming session"}`}
                  />
                  <StatusChip value={row.tasks.length ? "Needs Attention" : "On Track"} />
                </ListItem>
              ))}
            </List>
            {!loading && readinessRows.length === 0 && (
              <EmptyState title="No cohort readiness items" description="Calendar invite tasks are handled automatically; actionable cohort work will appear here." />
            )}
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Upcoming Sessions" href="/cohorts" actionLabel="View cohorts">
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              {["list", "calendar"].map((view) => (
                <Button key={view} size="small" variant={sessionView === view ? "contained" : "outlined"} onClick={() => setSessionView(view)}>
                  {formatStatusLabel(view)}
                </Button>
              ))}
            </Stack>
            {sessionView === "list" ? (
              <List dense>
                {(data?.upcomingSessions ?? []).slice(0, 5).map((session: AdminRow) => (
                  <ListItem key={session.id} divider>
                    <Box sx={{ minWidth: 74, mr: 1.5 }}>
                      <Typography variant="h4" color="primary.main">{shortDate(session.startTime)}</Typography>
                      <Typography variant="caption" color="text.secondary">{timeText(session.startTime)}</Typography>
                    </Box>
                    <ListItemText
                      primary={session.title}
                      secondary={session.cohort?.title ?? "Cohort"}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Grid container spacing={1}>
                {(data?.upcomingSessions ?? []).slice(0, 6).map((session: AdminRow) => (
                  <Grid size={{ xs: 12, sm: 6 }} key={session.id}>
                    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25, minHeight: 96 }}>
                      <Typography variant="h4" color="primary.main">{shortDate(session.startTime)}</Typography>
                      <Typography fontWeight={800}>{session.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{timeText(session.startTime)} • {session.cohort?.title ?? "Cohort"}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            )}
            {!loading && (data?.upcomingSessions ?? []).length === 0 && (
              <EmptyState title="No upcoming sessions" description="Upcoming cohort sessions will appear here." />
            )}
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Recent Registrations" href="/registrations" actionLabel="View registrations">
            <List dense>
              {(data?.recentRegistrations ?? []).slice(0, 5).map((registration: AdminRow) => (
                <ListItem key={registration.id} divider>
                  <ListItemText
                    primary={formatProperDisplay(registration.primaryContactName)}
                    secondary={
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        <MetadataPill>{formatProperDisplay(registration.organization?.name ?? "Organization")}</MetadataPill>
                        <MetadataPill>{registration.cohort?.title ?? "Cohort"}</MetadataPill>
                      </Stack>
                    }
                  />
                  <StatusChip value={registration.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.recentRegistrations ?? []).length === 0 && (
              <EmptyState title="No recent registrations" description="New registrations will appear here as they arrive." />
            )}
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Cohorts Needing Attention" href="/cohorts" actionLabel="View cohorts">
            <List dense>
              {(data?.cohortsNeedingAttention ?? []).slice(0, 5).map((cohort: AdminRow) => (
                <ListItem key={cohort.id} divider>
                  <ListItemText
                    primary={cohort.title}
                    secondary={`${formatProperDisplay(`${cohort.presenter?.firstName ?? ""} ${cohort.presenter?.lastName ?? ""}`)} • ${cohort._count?.registrations ?? 0} registrations`}
                  />
                  <StatusChip value={cohort.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.cohortsNeedingAttention ?? []).length === 0 && (
              <EmptyState title="No cohorts need attention" description="Draft and registration-stage cohorts will appear here." />
            )}
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Payment Status Snapshot" href="/registrations" actionLabel="View registrations">
            <TextField select label="Status" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} sx={{ minWidth: 180, mb: 1 }}>
              <MenuItem value="ALL">All statuses</MenuItem>
              {(data?.paymentStatusSnapshot ?? []).map((payment: AdminRow) => <MenuItem value={payment.status} key={payment.status}>{formatStatusLabel(payment.status)}</MenuItem>)}
            </TextField>
            <Stack spacing={1.25}>
              {filteredPayments.map((payment: AdminRow) => {
                const amount = Number(payment._sum?.amount ?? 0);
                return (
                  <Box key={payment.status}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                      <StatusChip value={payment.status} />
                      <Typography fontWeight={800}>${amount.toLocaleString()}</Typography>
                    </Stack>
                    <Box sx={{ height: 10, borderRadius: 999, bgcolor: "background.default", overflow: "hidden" }}>
                      <Box sx={{ width: `${Math.max(8, (amount / maxPaymentAmount) * 100)}%`, height: "100%", bgcolor: "primary.main", borderRadius: 999 }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{payment._count?.status ?? 0} records</Typography>
                  </Box>
                );
              })}
            </Stack>
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Recent Activity" action={<Button component={Link} href="/settings" size="small" variant="outlined">View settings</Button>}>
            <List dense>
              {(data?.recentActivity ?? []).slice(0, 5).map((activity: AdminRow) => (
                <ListItem key={activity.id} divider>
                  <ListItemText
                    primary={`${formatHumanLabel(activity.entityType)} ${formatStatusLabel(activity.action)}`}
                    secondary={`${activity.description ?? "Activity"} • ${new Date(activity.createdAt).toLocaleString()}`}
                  />
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
      </Grid>
      <Dialog open={Boolean(readinessCohort)} onClose={() => setReadinessCohort(null)} fullWidth maxWidth="md">
        <DialogTitle>{readinessCohort?.cohort?.title ?? "Cohort Readiness"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}><MetadataPill>{readinessCohort?.registrationCount ?? 0} registrations</MetadataPill></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><MetadataPill>{readinessCohort?.participantCount ?? 0} participants</MetadataPill></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><MetadataPill>{readinessCohort?.nextSession ? `Next ${shortDate(readinessCohort.nextSession.startTime)}` : "No upcoming session"}</MetadataPill></Grid>
            </Grid>
            <Divider />
            <List dense>
              {(readinessCohort?.tasks ?? []).map((task: AdminRow) => (
                <ListItem key={task.id} divider>
                  <ListItemText primary={task.title} secondary={`${formatStatusLabel(task.category)} • ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}`} />
                  <StatusChip value={task.status} />
                </ListItem>
              ))}
            </List>
            {(readinessCohort?.tasks ?? []).length === 0 && <EmptyState title="No manual readiness tasks" description="Calendar invite work is handled automatically or no action is needed right now." />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadinessCohort(null)}>Close</Button>
        </DialogActions>
      </Dialog>
      {snackbar}
    </PageStack>
  );
}
