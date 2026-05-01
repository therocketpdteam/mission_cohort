"use client";

import AddIcon from "@mui/icons-material/Add";
import EditOutlined from "@mui/icons-material/EditOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import ReplayOutlined from "@mui/icons-material/ReplayOutlined";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
import { Box, Button, Chip, Grid, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import {
  AdminRow,
  FieldConfig,
  MutationDialog,
  PageHeader,
  PageStack,
  SectionCard,
  StatusChip,
  TableShell,
  useNotifier
} from "./common";

function mappingFields(cohorts: AdminRow[]): FieldConfig[] {
  return [
    { name: "formId", label: "Jotform form ID", required: true },
    { name: "label", label: "Label", required: true },
    { name: "sessionCount", label: "Session count", type: "number", required: true },
    {
      name: "defaultCohortId",
      label: "Default cohort",
      type: "select",
      options: [
        { label: "Use cohortSlug from URL", value: "" },
        ...cohorts.map((cohort) => ({ label: cohort.title, value: cohort.id }))
      ]
    },
    { name: "requireCohortSlug", label: "Require cohortSlug", type: "checkbox" },
    { name: "active", label: "Active", type: "checkbox" }
  ];
}

export function SettingsClient() {
  const [health, setHealth] = useState<AdminRow | null>(null);
  const [mappings, setMappings] = useState<AdminRow[]>([]);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<AdminRow | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<AdminRow[]>([]);
  const [testPayload, setTestPayload] = useState("{\n  \"formID\": \"\",\n  \"submissionID\": \"test-submission\",\n  \"cohortSlug\": \"\",\n  \"organizationName\": \"Demo District\",\n  \"primaryContactName\": \"Demo Contact\",\n  \"primaryContactEmail\": \"demo@example.com\",\n  \"participantCsv\": \"Jane Doe, jane@example.com\"\n}");
  const [testResult, setTestResult] = useState<AdminRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [healthData, mappingRows, cohortRows, integrationRows, eventRows] = await Promise.all([
      adminApi<AdminRow>("/api/health"),
      adminApi<AdminRow[]>("/api/jotform/mappings").catch(() => []),
      adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
      adminApi<AdminRow>("/api/integrations/status").catch(() => null),
      adminApi<AdminRow[]>("/api/webhooks/events").catch(() => [])
    ]);
    setHealth(healthData);
    setMappings(mappingRows);
    setCohorts(cohortRows);
    setIntegrationStatus(integrationRows);
    setWebhookEvents(eventRows);
  }

  useEffect(() => {
    load().catch((error) => notifyError(error.message));
  }, [notifyError]);

  const env = health?.env ?? {};

  async function saveMapping(values: AdminRow) {
    try {
      await adminApi("/api/jotform/mappings", {
        method: editing ? "PATCH" : "POST",
        body: editing ? { ...values, id: editing.id } : values
      });
      notifySuccess(editing ? "Jotform mapping updated" : "Jotform mapping created");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function toggleMapping(row: AdminRow) {
    try {
      await adminApi("/api/jotform/mappings", {
        method: "PATCH",
        body: { id: row.id, active: !row.active }
      });
      notifySuccess(row.active ? "Jotform mapping deactivated" : "Jotform mapping activated");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function testJotformPayload() {
    try {
      const result = await adminApi<AdminRow>("/api/jotform/test", {
        method: "POST",
        body: JSON.parse(testPayload)
      });
      setTestResult(result);
      notifySuccess("Jotform payload normalized");
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function replayWebhook(row: AdminRow) {
    try {
      await adminApi("/api/webhooks/replay", { method: "POST", body: { id: row.id } });
      notifySuccess("Webhook replay queued");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const mappingColumns: GridColDef[] = [
    { field: "label", headerName: "Label", flex: 1, minWidth: 180 },
    { field: "formId", headerName: "Form ID", width: 160 },
    { field: "sessionCount", headerName: "Sessions", width: 110 },
    { field: "defaultCohort", headerName: "Default cohort", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.defaultCohort?.title ?? "Requires cohortSlug" },
    { field: "requireCohortSlug", headerName: "Requires slug", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 230,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditing(params.row); setDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" startIcon={<PowerSettingsNewOutlined />} onClick={() => toggleMapping(params.row)}>
            {params.row.active ? "Disable" : "Enable"}
          </Button>
        </Stack>
      )
    }
  ];
  const eventColumns: GridColDef[] = [
    { field: "source", headerName: "Source", width: 130 },
    { field: "eventType", headerName: "Event", width: 190 },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "errorMessage", headerName: "Error", flex: 1, minWidth: 260 },
    { field: "createdAt", headerName: "Created", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 130,
      sortable: false,
      renderCell: (params) => (
        <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={() => replayWebhook(params.row)}>
          Replay
        </Button>
      )
    }
  ];
  const providers = [
    ["Google Calendar", env.googleCalendarConfigured, "/api/integrations/google/connect"],
    ["QuickBooks", env.quickBooksConfigured, "/api/integrations/quickbooks/connect"],
    ["SendGrid", env.sendgridConfigured, ""],
    ["CRM", env.crmConfigured, ""],
    ["Mux", env.muxConfigured, ""],
    ["Jotform", env.webhookSecretConfigured, ""]
  ];

  return (
    <PageStack>
      <PageHeader title="Settings" description="Runtime configuration status and integration setup." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <SectionCard title="System Health">
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between">
                <Typography>Database connection</Typography>
                <StatusChip value={health?.database ? "CONNECTED" : "UNAVAILABLE"} />
              </Stack>
              {Object.entries(env).map(([key, value]) => (
                <Stack direction="row" justifyContent="space-between" key={key}>
                  <Typography>{key}</Typography>
                  <StatusChip value={Boolean(value)} />
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <SectionCard title="Integration Hub">
            <Grid container spacing={1.5}>
              {providers.map(([label, configured, href]) => (
                <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={String(label)}>
                  <Stack spacing={1} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, minHeight: 112 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800}>{label}</Typography>
                      <StatusChip value={Boolean(configured)} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {(integrationStatus?.connections ?? []).find((connection: AdminRow) => String(connection.provider).includes(String(label).toUpperCase().replace(/\s+/g, "_")))?.status ?? "Env/config status"}
                    </Typography>
                    {href && <Button variant="outlined" href={String(href)}>Connect</Button>}
                  </Stack>
                </Grid>
              ))}
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Jotform Webhook Setup">
            <Typography color="text.secondary">
              Configure the three Jotform registration forms here. Use cohortSlug in the shared 5-session form URL so Mission Control can route submissions to the right cohort.
            </Typography>
            <Typography sx={{ mt: 2 }} variant="body2">
              Webhook endpoint: <Box component="code">/api/webhooks/registrations</Box>
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
              <Chip label="JSON" />
              <Chip label="form-data" />
              <Chip label="rawRequest" />
              <Chip label="cohortSlug" />
              <Chip label="participant CSV parser" />
              <Chip label="idempotent submissionID" />
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Jotform Form Mappings" action={<Button startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>Add Mapping</Button>}>
            <TableShell>
              <DataGrid rows={mappings} columns={mappingColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Jotform Dry Run" action={<Button startIcon={<ScienceOutlined />} onClick={testJotformPayload}>Normalize</Button>}>
            <Stack spacing={2}>
              <TextField fullWidth multiline minRows={10} value={testPayload} onChange={(event) => setTestPayload(event.target.value)} />
              {testResult && (
                <Box component="pre" sx={{ p: 2, bgcolor: "background.default", borderRadius: 1, overflow: "auto", maxHeight: 320 }}>
                  {JSON.stringify(testResult, null, 2)}
                </Box>
              )}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Webhook Events">
            <TableShell>
              <DataGrid rows={webhookEvents} columns={eventColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
          </SectionCard>
        </Grid>
      </Grid>
      <MutationDialog
        title={editing ? "Edit Jotform Mapping" : "Add Jotform Mapping"}
        open={dialogOpen}
        fields={mappingFields(cohorts)}
        initialValues={editing ?? { sessionCount: 5, active: true, requireCohortSlug: false }}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={saveMapping}
      />
      {snackbar}
    </PageStack>
  );
}
