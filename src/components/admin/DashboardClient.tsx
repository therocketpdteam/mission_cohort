"use client";

import AddIcon from "@mui/icons-material/Add";
import {
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
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { AdminRow, EmptyState, LoadingState, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

const metricLabels: ReadonlyArray<[string, string, Route]> = [
  ["activeCohorts", "Active Cohorts", "/cohorts"],
  ["upcomingSessions", "Upcoming Sessions", "/cohorts"],
  ["openRegistrations", "Open Registrations", "/registrations"],
  ["totalParticipants", "Total Participants", "/participants"],
  ["pendingPayments", "Pending Payments", "/payments"],
  ["scheduledCommunications", "Scheduled Communications", "/communications"],
  ["openOperationsTasks", "Open Operations Tasks", "/cohorts"]
];

const quickActions: ReadonlyArray<[string, Route]> = [
  ["Create Cohort", "/cohorts"],
  ["Add Registration", "/registrations"],
  ["Create Registration Form", "/forms"],
  ["Add Organization", "/organizations"],
  ["Create Email Template", "/communications"]
];

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

      <Grid container spacing={2}>
        {metricLabels.map(([key, label, href]) => (
          <Grid size={{ xs: 12, sm: 6, lg: key === "openOperationsTasks" ? 3 : 2 }} key={key}>
            <Link href={href}>
              <Card
                sx={{
                  display: "block",
                  transition: "border-color 120ms ease, transform 120ms ease",
                  "&:hover": { borderColor: "primary.main", transform: "translateY(-1px)" }
                }}
              >
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="h1" sx={{ mt: 1 }}>
                    {data?.metrics?.[key] ?? "-"}
                  </Typography>
                </CardContent>
              </Card>
            </Link>
          </Grid>
        ))}
      </Grid>

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
          <SectionCard title="Open Operations Tasks" action={<Button component={Link} href="/cohorts" variant="outlined">View cohorts</Button>}>
            <List dense>
              {(data?.openOperationsTasks ?? []).map((task: AdminRow) => (
                <ListItem key={task.id} divider>
                  <ListItemText
                    primary={task.title}
                    secondary={`${task.cohort?.title ?? "Operations"} • ${String(task.category ?? "").replace(/_/g, " ")}`}
                  />
                  <StatusChip value={task.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.openOperationsTasks ?? []).length === 0 && (
              <EmptyState title="No open operations tasks" description="Internal cohort checklist items will appear here." />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Upcoming Sessions" action={<Button component={Link} href="/cohorts" variant="outlined">View cohorts</Button>}>
            <List dense>
              {(data?.upcomingSessions ?? []).map((session: AdminRow) => (
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
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Recent Registrations" action={<Button component={Link} href="/registrations" variant="outlined">View registrations</Button>}>
            <List dense>
              {(data?.recentRegistrations ?? []).map((registration: AdminRow) => (
                <ListItem key={registration.id} divider>
                  <ListItemText
                    primary={registration.primaryContactName}
                    secondary={`${registration.organization?.name ?? "Organization"} • ${registration.cohort?.title ?? "Cohort"}`}
                  />
                  <StatusChip value={registration.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.recentRegistrations ?? []).length === 0 && (
              <EmptyState title="No recent registrations" description="New registrations will appear here as they arrive." />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Cohorts Needing Attention" action={<Button component={Link} href="/cohorts" variant="outlined">View cohorts</Button>}>
            <List dense>
              {(data?.cohortsNeedingAttention ?? []).map((cohort: AdminRow) => (
                <ListItem key={cohort.id} divider>
                  <ListItemText
                    primary={cohort.title}
                    secondary={`${cohort.presenter?.firstName ?? ""} ${cohort.presenter?.lastName ?? ""} • ${cohort._count?.registrations ?? 0} registrations`}
                  />
                  <StatusChip value={cohort.status} />
                </ListItem>
              ))}
            </List>
            {!loading && (data?.cohortsNeedingAttention ?? []).length === 0 && (
              <EmptyState title="No cohorts need attention" description="Draft and registration-stage cohorts will appear here." />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Payment Status Snapshot" action={<Button component={Link} href="/payments" variant="outlined">View payments</Button>}>
            <List dense>
              {(data?.paymentStatusSnapshot ?? []).map((payment: AdminRow) => (
                <ListItem key={payment.status} divider>
                  <ListItemText primary={<StatusChip value={payment.status} />} secondary={`${payment._count?.status ?? 0} records`} />
                  <Typography variant="body2">${Number(payment._sum?.amount ?? 0).toLocaleString()}</Typography>
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Recent Activity" action={<Button component={Link} href="/settings" variant="outlined">View settings</Button>}>
            <List dense>
              {(data?.recentActivity ?? []).map((activity: AdminRow) => (
                <ListItem key={activity.id} divider>
                  <ListItemText
                    primary={`${activity.entityType} ${activity.action}`}
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
