"use client";

import { Grid, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { AdminRow, PageHeader, PageStack, SectionCard, StatusChip, useNotifier } from "./common";

export function OrganizationDetailClient({ id }: { id: string }) {
  const [organization, setOrganization] = useState<AdminRow | null>(null);
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>(`/api/organizations?id=${id}`)
      .then(setOrganization)
      .catch((error) => notifyError(error.message));
  }, [id, notifyError]);

  return (
    <PageStack>
      <PageHeader
        title={organization?.name ?? "Organization"}
        description="Organization detail, registrations, participants, payments, and activity."
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Info">
            <Typography variant="body2" color="text.secondary">Type</Typography>
            <Typography sx={{ mb: 2 }}>{organization?.type ?? "-"}</Typography>
            <Typography variant="body2" color="text.secondary">Location</Typography>
            <Typography>{[organization?.city, organization?.state].filter(Boolean).join(", ") || "-"}</Typography>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Registrations">
            <List dense>
              {(organization?.registrations ?? []).map((registration: AdminRow) => (
                <ListItem key={registration.id} divider>
                  <ListItemText primary={registration.primaryContactName} secondary={registration.primaryContactEmail} />
                  <StatusChip value={registration.status} />
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Participants">
            <List dense>
              {(organization?.participants ?? []).map((participant: AdminRow) => (
                <ListItem key={participant.id} divider>
                  <ListItemText primary={`${participant.firstName} ${participant.lastName}`} secondary={participant.email} />
                  <StatusChip value={participant.status} />
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Payment Records">
            <List dense>
              {(organization?.paymentRecords ?? []).map((payment: AdminRow) => (
                <ListItem key={payment.id} divider>
                  <ListItemText primary={payment.invoiceNumber ?? "Payment record"} secondary={`$${Number(payment.amount ?? 0).toLocaleString()}`} />
                  <StatusChip value={payment.status} />
                </ListItem>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Activity">
            <Typography color="text.secondary">Organization-specific audit stream placeholder for Prompt 3.</Typography>
          </SectionCard>
        </Grid>
      </Grid>
      {snackbar}
    </PageStack>
  );
}
