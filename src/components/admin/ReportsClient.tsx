"use client";

import AddLinkOutlined from "@mui/icons-material/AddLinkOutlined";
import BlockOutlined from "@mui/icons-material/BlockOutlined";
import { Box, Button, Grid, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { AdminRow, EmptyState, PageHeader, PageStack, SectionCard, StatusChip, TableShell, useNotifier } from "./common";

export function ReportsClient() {
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [reports, setReports] = useState<AdminRow[]>([]);
  const [links, setLinks] = useState<AdminRow[]>([]);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load(cohortId = selectedCohortId) {
    const [cohortRows, reportData] = await Promise.all([
      adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
      adminApi<AdminRow>(`/api/reports?includeLinks=true${cohortId ? `&cohortId=${cohortId}` : ""}`)
    ]);
    setCohorts(cohortRows);
    setReports(reportData.reports ?? []);
    setLinks(reportData.links ?? []);
  }

  useEffect(() => {
    load().catch((error) => notifyError(error.message));
  }, [notifyError]);

  const currentReport = reports[0];
  const metrics = useMemo(() => {
    if (!currentReport) {
      return [];
    }

    return [
      ["Registrations", currentReport.registrationSummary?.total ?? 0],
      ["Participants", currentReport.participantSummary?.total ?? 0],
      ["Pending Amount", `$${Number(currentReport.paymentSummary?.pendingAmount ?? 0).toLocaleString()}`],
      ["Open Tasks", currentReport.readiness?.openTasks ?? 0],
      ["Scheduled Emails", currentReport.readiness?.scheduledCommunications ?? 0]
    ];
  }, [currentReport]);

  async function createShareLink() {
    try {
      await adminApi("/api/reports", {
        method: "POST",
        body: {
          cohortId: selectedCohortId || undefined,
          title: selectedCohortId ? "Thought Leader Cohort Summary" : "Thought Leader Portfolio Summary",
          reportType: "cohort_summary",
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
        }
      });
      notifySuccess("Secure report link created");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function revokeLink(id: string) {
    try {
      await adminApi("/api/reports", { method: "PATCH", body: { id, action: "revoke" } });
      notifySuccess("Report link revoked");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const linkColumns: GridColDef[] = [
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "cohort", headerName: "Cohort", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "All cohorts" },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "expiresAt", headerName: "Expires", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    {
      field: "shareUrl",
      headerName: "Share URL",
      flex: 1,
      minWidth: 260,
      valueGetter: (_value, row) => `/reports/share/${row.token}`
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Button variant="outlined" color="error" startIcon={<BlockOutlined />} onClick={() => revokeLink(params.row.id)}>
          Revoke
        </Button>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader
        title="Reports"
        description="No-PII cohort reporting and secure thought leader share links."
        action={<Button startIcon={<AddLinkOutlined />} onClick={createShareLink}>Create Share Link</Button>}
      />
      <SectionCard title="Report Filters">
        <TextField
          select
          label="Cohort"
          value={selectedCohortId}
          onChange={(event) => { setSelectedCohortId(event.target.value); load(event.target.value); }}
          sx={{ minWidth: 360 }}
        >
          <MenuItem value="">All cohorts</MenuItem>
          {cohorts.map((cohort) => (
            <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>
          ))}
        </TextField>
      </SectionCard>
      <Grid container spacing={2}>
        {metrics.map(([label, value]) => (
          <Grid size={{ xs: 12, sm: 6, lg: 2.4 }} key={String(label)}>
            <SectionCard title={String(label)}>
              <Typography variant="h2">{value}</Typography>
            </SectionCard>
          </Grid>
        ))}
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Participants By Organization">
            {currentReport ? (
              <Stack spacing={1}>
                {Object.entries(currentReport.participantSummary?.byOrganization ?? {}).map(([name, count]) => (
                  <Stack key={name} direction="row" justifyContent="space-between">
                    <Typography>{name}</Typography>
                    <Typography fontWeight={800}>{String(count)}</Typography>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <EmptyState title="No report data" description="Select a cohort or create registration data to populate reports." />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Payment Status Snapshot">
            <Box component="pre" sx={{ p: 2, bgcolor: "background.default", borderRadius: 1, overflow: "auto" }}>
              {JSON.stringify(currentReport?.paymentSummary?.byStatus ?? {}, null, 2)}
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Secure Share Links">
            <TableShell>
              <DataGrid rows={links} columns={linkColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
          </SectionCard>
        </Grid>
      </Grid>
      {snackbar}
    </PageStack>
  );
}
