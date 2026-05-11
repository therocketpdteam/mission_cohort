"use client";

import AddIcon from "@mui/icons-material/Add";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import ReplayOutlined from "@mui/icons-material/ReplayOutlined";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
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

const roleOptions = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "SALES", "PRESENTER", "VIEWER"].map((value) => ({
  label: value.replace(/_/g, " "),
  value
}));

function userFields(editing: AdminRow | null): FieldConfig[] {
  return [
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "role", label: "Role", type: "select", options: roleOptions, required: true },
    { name: "active", label: "Active", type: "checkbox" },
    { name: "sendInvite", label: "Send Supabase invite email", type: "checkbox" },
    { name: "password", label: editing ? "New password (optional)" : "Temporary password", type: "password", required: !editing }
  ];
}

function JotformMappingWizard({
  event,
  cohorts,
  existingMapping,
  onClose,
  onSaved
}: {
  event: AdminRow | null;
  cohorts: AdminRow[];
  existingMapping?: AdminRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const preview = event?.preview ?? {};
  const [sessionCount, setSessionCount] = useState(5);
  const [routingMode, setRoutingMode] = useState<"default" | "slug">("slug");
  const [defaultCohortId, setDefaultCohortId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (event) {
      const detectedCount = Number(existingMapping?.sessionCount ?? 5);
      const useSlug = Boolean(existingMapping?.requireCohortSlug ?? preview.cohortSlug);
      setSessionCount(detectedCount);
      setRoutingMode(useSlug ? "slug" : "default");
      setDefaultCohortId(existingMapping?.defaultCohortId ?? "");
      setLabel(existingMapping?.label ?? `Jotform ${preview.formId || "form"} intake`);
      setError(null);
    }
  }, [event, existingMapping, preview.cohortSlug, preview.formId]);

  async function save() {
    if (!event) {
      return;
    }

    if (!preview.formId) {
      setError("This submission does not include a Jotform formID.");
      return;
    }

    if (routingMode === "default" && !defaultCohortId) {
      setError("Choose a default cohort or switch to cohortSlug routing.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await adminApi("/api/jotform/mappings", {
        method: existingMapping ? "PATCH" : "POST",
        body: {
          id: existingMapping?.id,
          formId: preview.formId,
          label,
          sessionCount,
          defaultCohortId: routingMode === "default" ? defaultCohortId : "",
          requireCohortSlug: routingMode === "slug",
          active: true
        }
      });
      await onSaved();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(event)} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Jotform Mapping Wizard</DialogTitle>
      <DialogContent>
        {event && (
          <Stack spacing={2}>
            {error && <Typography color="error">{error}</Typography>}
            <Grid container spacing={2}>
              {[
                ["Form ID", preview.formId || "-"],
                ["Submission ID", preview.submissionId || "-"],
                ["Detected Contact", preview.primaryContactName || "-"],
                ["Detected Email", preview.primaryContactEmail || "-"],
                ["Detected Organization", preview.organizationName || "-"],
                ["cohortSlug", preview.cohortSlug || "-"],
                ["Parsed Participants", preview.parsedParticipantCount ?? 0],
                ["Participant Count", preview.participantCount ?? 0]
              ].map(([name, value]) => (
                <Grid size={{ xs: 12, sm: 6, md: 3 }} key={String(name)}>
                  <Typography variant="body2" color="text.secondary">{name}</Typography>
                  <Typography>{String(value)}</Typography>
                </Grid>
              ))}
            </Grid>
            <Divider />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField fullWidth label="Mapping label" value={label} onChange={(event) => setLabel(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <TextField select fullWidth label="Session count" value={sessionCount} onChange={(event) => setSessionCount(Number(event.target.value))}>
                  {[3, 5, 8].map((value) => <MenuItem value={value} key={value}>{value} sessions</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <TextField select fullWidth label="Routing" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as "default" | "slug")}>
                  <MenuItem value="default">Default cohort</MenuItem>
                  <MenuItem value="slug">Require cohortSlug</MenuItem>
                </TextField>
              </Grid>
              {routingMode === "default" && (
                <Grid size={{ xs: 12 }}>
                  <TextField select fullWidth label="Default cohort" value={defaultCohortId} onChange={(event) => setDefaultCohortId(event.target.value)}>
                    {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
                  </TextField>
                </Grid>
              )}
            </Grid>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="h4" sx={{ mb: 1 }}>Detected Fields</Typography>
                <Box component="pre" sx={{ p: 2, bgcolor: "background.default", borderRadius: 1, overflow: "auto", maxHeight: 300 }}>
                  {JSON.stringify(preview.fieldPreview ?? [], null, 2)}
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="h4" sx={{ mb: 1 }}>Normalized Preview</Typography>
                <Box component="pre" sx={{ p: 2, bgcolor: "background.default", borderRadius: 1, overflow: "auto", maxHeight: 300 }}>
                  {JSON.stringify(preview.normalized ?? preview.participantParseErrors ?? {}, null, 2)}
                </Box>
              </Grid>
            </Grid>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving" : "Save Mapping"}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SettingsClient() {
  const [health, setHealth] = useState<AdminRow | null>(null);
  const [users, setUsers] = useState<AdminRow[]>([]);
  const [mappings, setMappings] = useState<AdminRow[]>([]);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<AdminRow | null>(null);
  const [jotformSetup, setJotformSetup] = useState<AdminRow | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<AdminRow[]>([]);
  const [mappingWizardEvent, setMappingWizardEvent] = useState<AdminRow | null>(null);
  const [testPayload, setTestPayload] = useState("{\n  \"formID\": \"\",\n  \"submissionID\": \"test-submission\",\n  \"cohortSlug\": \"\",\n  \"organizationName\": \"Demo District\",\n  \"primaryContactName\": \"Demo Contact\",\n  \"primaryContactEmail\": \"demo@example.com\",\n  \"participantCsv\": \"Jane Doe, jane@example.com\"\n}");
  const [testResult, setTestResult] = useState<AdminRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [healthData, userRows, mappingRows, cohortRows, integrationRows, intakeData] = await Promise.all([
      adminApi<AdminRow>("/api/health"),
      adminApi<AdminRow[]>("/api/users").catch(() => []),
      adminApi<AdminRow[]>("/api/jotform/mappings").catch(() => []),
      adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
      adminApi<AdminRow>("/api/integrations/status").catch(() => null),
      adminApi<AdminRow>("/api/jotform/intake").catch(() => ({ setup: null, events: [] }))
    ]);
    setHealth(healthData);
    setUsers(userRows);
    setMappings(mappingRows);
    setCohorts(cohortRows);
    setIntegrationStatus(integrationRows);
    setJotformSetup(intakeData?.setup ?? null);
    setWebhookEvents(intakeData?.events ?? []);
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

  async function saveUser(values: AdminRow) {
    try {
      const payload = { ...values };

      if (editingUser && !payload.password) {
        delete payload.password;
      }

      await adminApi("/api/users", {
        method: editingUser ? "PATCH" : "POST",
        body: editingUser ? { ...payload, id: editingUser.id } : payload
      });
      notifySuccess(editingUser ? "User updated" : "User created");
      setEditingUser(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function toggleUser(row: AdminRow) {
    try {
      await adminApi("/api/users", {
        method: "PATCH",
        body: { id: row.id, active: !row.active }
      });
      notifySuccess(row.active ? "User deactivated" : "User activated");
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
      await adminApi("/api/jotform/replay", { method: "POST", body: { id: row.id } });
      notifySuccess("Jotform submission replayed");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function rotateJotformSecret() {
    try {
      const setup = await adminApi<AdminRow>("/api/jotform/secret/rotate", { method: "POST" });
      setJotformSetup(setup);
      notifySuccess("Jotform webhook secret generated");
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function copyJotformWebhookUrl() {
    try {
      const webhookUrl = String(jotformSetup?.webhookUrl ?? "");

      if (!webhookUrl) {
        throw new Error("Generate a Jotform webhook secret first.");
      }

      await navigator.clipboard.writeText(webhookUrl);
      notifySuccess("Jotform webhook URL copied");
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
  const userColumns: GridColDef[] = [
    { field: "name", headerName: "User", flex: 1, minWidth: 180, valueGetter: (_value, row) => `${row.firstName} ${row.lastName}` },
    { field: "email", headerName: "Email", flex: 1.2, minWidth: 240 },
    { field: "role", headerName: "Role", width: 160, valueFormatter: (value) => String(value ?? "").replace(/_/g, " ") },
    { field: "active", headerName: "Active", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "updatedAt", headerName: "Updated", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 230,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => { setEditingUser(params.row); setUserDialogOpen(true); }}>
            Edit
          </Button>
          <Button variant="outlined" startIcon={<PowerSettingsNewOutlined />} onClick={() => toggleUser(params.row)}>
            {params.row.active ? "Disable" : "Enable"}
          </Button>
        </Stack>
      )
    }
  ];
  const eventColumns: GridColDef[] = [
    { field: "reviewStatus", headerName: "Review", width: 150, valueGetter: (_value, row) => row.reviewStatus ?? row.status, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "formId", headerName: "Form ID", width: 145, valueGetter: (_value, row) => row.preview?.formId ?? "-" },
    { field: "submissionId", headerName: "Submission ID", minWidth: 170, flex: 0.9, valueGetter: (_value, row) => row.preview?.submissionId ?? "-" },
    { field: "contact", headerName: "Detected contact", minWidth: 190, flex: 1, valueGetter: (_value, row) => row.preview?.primaryContactName ?? row.preview?.primaryContactEmail ?? "-" },
    { field: "organization", headerName: "Organization", minWidth: 180, flex: 1, valueGetter: (_value, row) => row.preview?.organizationName ?? "-" },
    { field: "cohortSlug", headerName: "cohortSlug", width: 160, valueGetter: (_value, row) => row.preview?.cohortSlug ?? "-" },
    {
      field: "participants",
      headerName: "Participants",
      width: 135,
      valueGetter: (_value, row) => {
        const parsed = row.preview?.parsedParticipantCount ?? 0;
        const expected = row.preview?.participantCount ?? 0;
        return expected ? `${parsed}/${expected}` : String(parsed);
      }
    },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "errorMessage", headerName: "Error", flex: 1, minWidth: 260 },
    { field: "createdAt", headerName: "Created", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 220,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setMappingWizardEvent(params.row)}>
            Map
          </Button>
          <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={() => replayWebhook(params.row)}>
            Replay
          </Button>
        </Stack>
      )
    }
  ];
  const currentWizardMapping = mappingWizardEvent
    ? mappings.find((mapping) => mapping.formId === mappingWizardEvent.preview?.formId)
    : undefined;
  const providers = [
    ["Google Calendar", env.googleCalendarConfigured, "/api/integrations/google/connect"],
    ["QuickBooks", env.quickBooksConfigured, "/api/integrations/quickbooks/connect"],
    ["SendGrid", env.sendgridConfigured, ""],
    ["CRM", env.crmConfigured, ""],
    ["Mux", env.muxConfigured, ""],
    ["Jotform", Boolean(jotformSetup?.configured || env.webhookSecretConfigured), ""]
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
          <SectionCard title="Admin Users" action={<Button startIcon={<AddIcon />} onClick={() => setUserDialogOpen(true)}>Add User</Button>}>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Users authenticate through Supabase Auth. Mission Control roles and active status control internal authorization.
            </Typography>
            <TableShell>
              <DataGrid rows={users} columns={userColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
            </TableShell>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard
            title="Jotform Intake Setup"
            action={
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button variant="outlined" startIcon={<ContentCopyOutlined />} onClick={copyJotformWebhookUrl}>
                  Copy URL
                </Button>
                <Button startIcon={<KeyOutlined />} onClick={rotateJotformSecret}>
                  Generate / Rotate Secret
                </Button>
              </Stack>
            }
          >
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "flex-start", md: "center" }}>
                <Box sx={{ flex: 1 }}>
                  <Typography color="text.secondary">
                    WEBHOOK_SECRET is not from Jotform. Mission Control generates this Jotform-specific shared secret and gives you the exact URL to paste into the Jotform webhook settings. The old Vercel WEBHOOK_SECRET still works as fallback.
                  </Typography>
                </Box>
                <StatusChip value={jotformSetup?.configured ? "CONFIGURED" : "NEEDS SECRET"} />
              </Stack>
              <TextField
                fullWidth
                label="Copy this webhook URL into Jotform"
                value={jotformSetup?.webhookUrl ?? "Generate a Jotform secret to create the webhook URL"}
                InputProps={{ readOnly: true }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label="JSON" />
                <Chip label="form-data" />
                <Chip label="rawRequest" />
                <Chip label="cohortSlug" />
                <Chip label="participant CSV parser" />
                <Chip label="idempotent submissionID" />
                <Chip label="hold + review for unmapped forms" />
              </Stack>
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
          <SectionCard title="Test Submissions / Review Queue">
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Real Jotform submissions appear here first. If a form is unmapped, create the mapping from the received submission, then replay it into registrations.
            </Typography>
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
      <MutationDialog
        title={editingUser ? "Edit Admin User" : "Create Admin User"}
        open={userDialogOpen}
        fields={userFields(editingUser)}
        initialValues={editingUser ?? { role: "VIEWER", active: true, sendInvite: false }}
        onClose={() => { setUserDialogOpen(false); setEditingUser(null); }}
        onSubmit={saveUser}
      />
      <JotformMappingWizard
        event={mappingWizardEvent}
        cohorts={cohorts}
        existingMapping={currentWizardMapping}
        onClose={() => setMappingWizardEvent(null)}
        onSaved={async () => {
          notifySuccess("Jotform mapping saved");
          await load();
        }}
      />
      {snackbar}
    </PageStack>
  );
}
