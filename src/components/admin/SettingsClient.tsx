"use client";

import { Grid, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { AdminRow, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

export function SettingsClient() {
  const [health, setHealth] = useState<AdminRow | null>(null);
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>("/api/health")
      .then(setHealth)
      .catch((error) => notifyError(error.message));
  }, [notifyError]);

  const env = health?.env ?? {};

  return (
    <PageStack>
      <PageHeader title="Settings" description="Runtime configuration status and integration placeholders." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="System Health">
            <List dense>
              <ListItem divider>
                <ListItemText primary="Database connection" />
                <StatusChip value={health?.database ? "CONNECTED" : "UNAVAILABLE"} />
              </ListItem>
              {Object.entries(env).map(([key, value]) => (
                <ListItem key={key} divider>
                  <ListItemText primary={key} />
                  <StatusChip value={Boolean(value)} />
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Prompt 3 Stubs">
            <Typography color="text.secondary">
              Supabase session enforcement, SendGrid send jobs, Google OAuth connection, webhook replay tooling, and background scheduling are ready as integration boundaries.
            </Typography>
          </SectionCard>
        </Grid>
      </Grid>
      {snackbar}
    </PageStack>
  );
}
