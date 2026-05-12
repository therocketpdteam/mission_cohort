"use client";

import AddIcon from "@mui/icons-material/Add";
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
  Typography
} from "@mui/material";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatHumanLabel, formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, EmptyState, LoadingState, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

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

export function DashboardClient() {
  const [data, setData] = useState<AdminRow | null>(null);
  const [loading, setLoading] = useState(true);
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>("/api/admin-dashboard")
      .then(setData)
      .catch((error) => notifyError(error.message))
      .finally(() => setLoading(false));
  }, [notifyError]);

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
              {(data?.openOperationsTasks ?? []).slice(0, 5).map((task: AdminRow) => (
                <ListItem key={task.id} divider>
                  <ListItemText
                    primary={task.title}
                    secondary={`${task.cohort?.title ?? "Operations"} • ${formatStatusLabel(task.category)}`}
                  />
                  <StatusChip value={task.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.openOperationsTasks ?? []).length === 0 && (
              <EmptyState title="No open operations tasks" description="Internal cohort checklist items will appear here." />
            )}
          </DashboardPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DashboardPanel title="Upcoming Sessions" href="/cohorts" actionLabel="View cohorts">
            <List dense>
              {(data?.upcomingSessions ?? []).slice(0, 5).map((session: AdminRow) => (
                <ListItem key={session.id} divider>
                  <ListItemText
                    primary={session.title}
                    secondary={`${session.cohort?.title ?? "Cohort"} • ${new Date(session.startTime).toLocaleString()}`}
                  />
                </ListItem>
              ))}
            </List>
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
                    secondary={`${formatProperDisplay(registration.organization?.name ?? "Organization")} • ${registration.cohort?.title ?? "Cohort"}`}
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
            <List dense>
              {(data?.paymentStatusSnapshot ?? []).map((payment: AdminRow) => (
                <ListItem key={payment.status} divider>
                  <ListItemText primary={<StatusChip value={payment.status} />} secondary={`${payment._count?.status ?? 0} records`} />
                  <Typography variant="body2">${Number(payment._sum?.amount ?? 0).toLocaleString()}</Typography>
                </ListItem>
              ))}
            </List>
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
      {snackbar}
    </PageStack>
  );
}
