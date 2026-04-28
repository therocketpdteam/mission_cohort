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
import { AdminRow, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

const metricLabels = [
  ["activeCohorts", "Active Cohorts"],
  ["upcomingSessions", "Upcoming Sessions"],
  ["openRegistrations", "Open Registrations"],
  ["totalParticipants", "Total Participants"],
  ["pendingPayments", "Pending Payments"],
  ["scheduledCommunications", "Scheduled Communications"]
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
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>("/api/admin-dashboard")
      .then(setData)
      .catch((error) => notifyError(error.message));
  }, [notifyError]);

  return (
    <PageStack>
      <PageHeader
        title="Dashboard"
        description="Operational snapshot for cohorts, registrations, sessions, payments, and communications."
      />

      <Grid container spacing={2}>
        {metricLabels.map(([key, label]) => (
          <Grid size={{ xs: 12, sm: 6, lg: 2 }} key={key}>
            <Card>
              <CardContent>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="h1" sx={{ mt: 1 }}>
                  {data?.metrics?.[key] ?? "-"}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

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
          <SectionCard title="Upcoming Sessions">
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
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Recent Registrations">
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
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Cohorts Needing Attention">
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
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Payment Status Snapshot">
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
          <SectionCard title="Recent Activity">
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
