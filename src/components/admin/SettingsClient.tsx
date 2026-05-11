"use client";

import AddIcon from "@mui/icons-material/Add";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutline";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import ReplayOutlined from "@mui/icons-material/ReplayOutlined";
import RouteOutlined from "@mui/icons-material/RouteOutlined";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useEffect, useState } from "react";
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

const wizardSteps = ["Summary", "Routing", "Detected Fields", "Preview", "Save & Replay"];

function InfoTile({ label, value }: { label: string; value: unknown }) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, minHeight: 74 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography fontWeight={800} sx={{ mt: 0.25, overflowWrap: "anywhere" }}>
        {value == null || value === "" ? "-" : String(value)}
      </Typography>
    </Box>
  );
}

function FieldChipGroup({ title, fields }: { title: string; fields: Array<[string, unknown]> }) {
  const visibleFields = fields.filter(([, value]) => value != null && value !== "");

  return (
    <Stack spacing={1}>
      <Typography variant="h4">{title}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {visibleFields.length > 0
          ? visibleFields.map(([label, value]) => (
              <Chip
                key={label}
                label={`${label}: ${String(value).slice(0, 90)}`}
                variant="outlined"
                sx={{ maxWidth: "100%", justifyContent: "flex-start" }}
              />
            ))
          : <Chip label="No value detected" variant="outlined" />}
      </Stack>
    </Stack>
  );
}

function JotformMappingWizard({
  event,
  cohorts,
  existingMapping,
  onClose,
  onSaved,
  onReplay
}: {
  event: AdminRow | null;
  cohorts: AdminRow[];
  existingMapping?: AdminRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReplay: (event: AdminRow) => Promise<void>;
}) {
  const preview = event?.preview ?? {};
  const readiness = event?.readiness ?? {};
  const [sessionCount, setSessionCount] = useState(5);
  const [routingMode, setRoutingMode] = useState<"default" | "slug">("slug");
  const [defaultCohortId, setDefaultCohortId] = useState("");
  const [label, setLabel] = useState("");
  const [activeStep, setActiveStep] = useState(0);
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
      setActiveStep(0);
      setError(null);
    }
  }, [event, existingMapping, preview.cohortSlug, preview.formId]);

  async function save({ replayAfterSave = false } = {}) {
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
      if (replayAfterSave) {
        await onReplay(event);
      }
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const normalized = preview.normalized ?? {};
  const registration = normalized.registration ?? {};
  const organization = normalized.organization ?? {};
  const payment = normalized.payment ?? {};
  const participants = Array.isArray(normalized.participants) ? normalized.participants : [];
  const missingFields = Array.isArray(readiness.missingRequiredFields) ? readiness.missingRequiredFields : [];
  const detectedFieldGroups = [
    {
      title: "Contact",
      fields: [
        ["Name", preview.primaryContactName],
        ["Email", preview.primaryContactEmail],
        ["Phone", registration.primaryContactPhone],
        ["Title", registration.primaryContactTitle]
      ] as Array<[string, unknown]>
    },
    {
      title: "Organization",
      fields: [
        ["Name", preview.organizationName],
        ["Address", registration.billingAddress],
        ["Phone", organization.phone]
      ] as Array<[string, unknown]>
    },
    {
      title: "Payment",
      fields: [
        ["Method", registration.paymentMethod],
        ["Status", registration.paymentStatus],
        ["Amount", registration.totalAmount],
        ["Invoice", registration.invoiceNumber],
        ["PO", registration.purchaseOrderNumber]
      ] as Array<[string, unknown]>
    },
    {
      title: "Routing",
      fields: [
        ["Form ID", preview.formId],
        ["Submission ID", preview.submissionId],
        ["cohortSlug", preview.cohortSlug],
        ["Current mapping", preview.hasMapping ? "Mapped" : "Not mapped"]
      ] as Array<[string, unknown]>
    }
  ];

  return (
    <Dialog open={Boolean(event)} onClose={onClose} fullWidth maxWidth="lg" PaperProps={{ sx: { minHeight: "80vh" } }}>
      <DialogTitle>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
          <Box>
            <Typography variant="h3">Review Jotform Submission</Typography>
            <Typography color="text.secondary" variant="body2">
              Confirm the route, preview what Mission Control will create, then replay when ready.
            </Typography>
          </Box>
          <StatusChip value={event?.reviewStatus ?? event?.status} />
        </Stack>
      </DialogTitle>
      <DialogContent>
        {event && (
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ display: { xs: "none", md: "flex" } }}>
              {wizardSteps.map((step) => (
                <Step key={step}>
                  <StepLabel>{step}</StepLabel>
                </Step>
              ))}
            </Stepper>
            {error && <Alert severity="error">{error}</Alert>}
            {readiness.recommendedAction && <Alert severity={event.reviewStatus === "PROCESSED" ? "success" : event.reviewStatus === "FAILED" ? "error" : "info"}>{readiness.recommendedAction}</Alert>}

            {activeStep === 0 && (
              <Stack spacing={2}>
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Form ID" value={preview.formId} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Submission ID" value={preview.submissionId} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Detected Contact" value={preview.primaryContactName || preview.primaryContactEmail} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Organization" value={preview.organizationName} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Cohort Route" value={preview.cohortSlug || registration.cohortId || "Needs routing"} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Participants" value={`${preview.parsedParticipantCount ?? 0}${preview.participantCount ? ` / ${preview.participantCount}` : ""}`} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Payment" value={[registration.paymentMethod, registration.paymentStatus].filter(Boolean).join(" / ")} /></Grid>
                  <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Amount" value={registration.totalAmount ? `$${Number(registration.totalAmount).toLocaleString()}` : ""} /></Grid>
                </Grid>
                {missingFields.length > 0 && (
                  <Alert severity="warning">
                    Missing: {missingFields.join(", ")}
                  </Alert>
                )}
                {preview.participantParseErrors?.length > 0 && (
                  <Alert severity="error">
                    Participant parsing issue: {preview.participantParseErrors.join("; ")}
                  </Alert>
                )}
              </Stack>
            )}

            {activeStep === 1 && (
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
                  <TextField select fullWidth label="Routing mode" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as "default" | "slug")}>
                    <MenuItem value="default">Use one default cohort</MenuItem>
                    <MenuItem value="slug">Require cohortSlug from Jotform URL</MenuItem>
                  </TextField>
                </Grid>
                {routingMode === "default" && (
                  <Grid size={{ xs: 12 }}>
                    <TextField select fullWidth label="Default cohort" value={defaultCohortId} onChange={(event) => setDefaultCohortId(event.target.value)}>
                      {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
                    </TextField>
                  </Grid>
                )}
                <Grid size={{ xs: 12 }}>
                  <Alert severity="info">
                    For the shared 5-session form, use cohortSlug routing. For one-form-one-cohort forms, choose a default cohort.
                  </Alert>
                </Grid>
              </Grid>
            )}

            {activeStep === 2 && (
              <Grid container spacing={2}>
                {detectedFieldGroups.map((group) => (
                  <Grid size={{ xs: 12, md: 6 }} key={group.title}>
                    <FieldChipGroup title={group.title} fields={group.fields} />
                  </Grid>
                ))}
                <Grid size={{ xs: 12 }}>
                  <FieldChipGroup
                    title="Participants"
                    fields={[
                      ["Parsed", preview.parsedParticipantCount ?? 0],
                      ["Expected", preview.participantCount ?? 0],
                      ["First participant", participants[0] ? `${participants[0].firstName} ${participants[0].lastName} (${participants[0].email})` : ""]
                    ]}
                  />
                </Grid>
              </Grid>
            )}

            {activeStep === 3 && (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Registration POC" value={`${registration.primaryContactName || "-"} ${registration.primaryContactEmail ? `<${registration.primaryContactEmail}>` : ""}`} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Organization" value={organization.name} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Cohort" value={preview.cohortSlug || registration.cohortId || "Selected by mapping"} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Participant roster" value={`${participants.length} parsed from submission`} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Payment record" value={`${payment.method || registration.paymentMethod || "Unknown"} / ${payment.status || registration.paymentStatus || "Unknown"}`} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Amount" value={payment.amount ? `$${Number(payment.amount).toLocaleString()}` : "$0"} /></Grid>
                {participants.length > 0 && (
                  <Grid size={{ xs: 12 }}>
                    <Stack spacing={1}>
                      <Typography variant="h4">Participant Preview</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {participants.slice(0, 12).map((participant: AdminRow) => (
                          <Chip key={participant.email} label={`${participant.firstName} ${participant.lastName} · ${participant.email}`} />
                        ))}
                        {participants.length > 12 && <Chip label={`+${participants.length - 12} more`} />}
                      </Stack>
                    </Stack>
                  </Grid>
                )}
              </Grid>
            )}

            {activeStep === 4 && (
              <Stack spacing={2}>
                <Alert severity={readiness.canReplay || event.reviewStatus === "PROCESSED" ? "success" : "warning"}>
                  {readiness.canReplay
                    ? "This submission is ready to replay into Mission Control."
                    : event.reviewStatus === "PROCESSED"
                      ? "This submission has already been processed."
                      : "Save the mapping first. If anything is still missing, Mission Control will keep the submission in review instead of creating bad data."}
                </Alert>
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Mapping" value={label} /></Grid>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Session count" value={`${sessionCount} sessions`} /></Grid>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Routing" value={routingMode === "slug" ? "Requires cohortSlug" : "Default cohort"} /></Grid>
                </Grid>
              </Stack>
            )}

            <Accordion disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                <Typography fontWeight={800}>Advanced payload</Typography>
              </AccordionSummary>
              <AccordionDetails>
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
              </AccordionDetails>
            </Accordion>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button variant="outlined" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>Back</Button>
        {activeStep < wizardSteps.length - 1 ? (
          <Button onClick={() => setActiveStep((step) => Math.min(wizardSteps.length - 1, step + 1))}>Next</Button>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => save()} disabled={saving}>{saving ? "Saving" : "Save Mapping"}</Button>
            <Button onClick={() => save({ replayAfterSave: true })} disabled={saving || event?.reviewStatus === "PROCESSED"}>
              {saving ? "Working" : "Save & Replay"}
            </Button>
          </Stack>
        )}
      </DialogActions>
    </Dialog>
  );
}

function JotformSubmissionCard({
  row,
  onReview,
  onReplay
}: {
  row: AdminRow;
  onReview: (row: AdminRow) => void;
  onReplay: (row: AdminRow) => void;
}) {
  const preview = row.preview ?? {};
  const readiness = row.readiness ?? {};
  const normalized = preview.normalized ?? {};
  const registration = normalized.registration ?? {};
  const status = row.reviewStatus ?? row.status;
  const statusIcon =
    status === "PROCESSED"
      ? <CheckCircleOutline fontSize="small" color="success" />
      : status === "FAILED"
        ? <WarningAmberOutlined fontSize="small" color="error" />
        : status === "NEEDS_MAPPING"
          ? <RouteOutlined fontSize="small" color="warning" />
          : <VisibilityOutlined fontSize="small" color="info" />;

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
            <Stack spacing={0.75} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                {statusIcon}
                <StatusChip value={status} />
              </Stack>
              <Typography variant="h4" sx={{ overflowWrap: "anywhere" }}>
                {preview.organizationName || "Unknown organization"}
              </Typography>
              <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {preview.primaryContactName || "Unknown contact"}{preview.primaryContactEmail ? ` · ${preview.primaryContactEmail}` : ""}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : ""}
            </Typography>
          </Stack>

          <Grid container spacing={1}>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Form" value={preview.formId || "Missing"} /></Grid>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Submission" value={preview.submissionId} /></Grid>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Cohort" value={preview.cohortSlug || registration.cohortId || "Needs route"} /></Grid>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Participants" value={`${preview.parsedParticipantCount ?? 0}${preview.participantCount ? ` / ${preview.participantCount}` : ""}`} /></Grid>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Payment" value={[registration.paymentMethod, registration.paymentStatus].filter(Boolean).join(" / ")} /></Grid>
            <Grid size={{ xs: 6, md: 4 }}><InfoTile label="Amount" value={registration.totalAmount ? `$${Number(registration.totalAmount).toLocaleString()}` : ""} /></Grid>
          </Grid>

          {(readiness.recommendedAction || row.errorMessage) && (
            <Alert severity={status === "FAILED" ? "error" : status === "PROCESSED" ? "success" : "info"}>
              {row.errorMessage || readiness.recommendedAction}
            </Alert>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button startIcon={<EditOutlined />} onClick={() => onReview(row)}>
              Review & Map
            </Button>
            <Button variant="outlined" startIcon={<ReplayOutlined />} disabled={status === "PROCESSED"} onClick={() => onReplay(row)}>
              Replay
            </Button>
            <Button variant="outlined" startIcon={<VisibilityOutlined />} onClick={() => onReview(row)}>
              View Details
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
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

  async function replayWebhook(row: AdminRow, throwOnError = false) {
    try {
      await adminApi("/api/jotform/replay", { method: "POST", body: { id: row.id } });
      notifySuccess("Jotform submission replayed");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      if (throwOnError) {
        throw error;
      }
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
          <SectionCard title="Test Submissions / Review Queue">
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Real Jotform submissions appear here first. Review the card, confirm the mapping, then replay it into registrations when ready.
            </Typography>
            {webhookEvents.length === 0 ? (
              <EmptyState
                title="No Jotform submissions received yet"
                description="Paste the webhook URL into Jotform, send a test submission, and it will show up here for review."
              />
            ) : (
              <Grid container spacing={2}>
                {webhookEvents.map((row) => (
                  <Grid size={{ xs: 12, xl: 6 }} key={row.id}>
                    <JotformSubmissionCard
                      row={row}
                      onReview={setMappingWizardEvent}
                      onReplay={(event) => { void replayWebhook(event); }}
                    />
                  </Grid>
                ))}
              </Grid>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Stack spacing={0.25}>
                <Typography variant="h3">Advanced Jotform Tools</Typography>
                <Typography color="text.secondary" variant="body2">
                  Manual mappings and JSON dry-runs live here for troubleshooting.
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12 }}>
                  <SectionCard title="Manual Form Mappings" action={<Button startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>Add Mapping</Button>}>
                    <TableShell>
                      <DataGrid rows={mappings} columns={mappingColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
                    </TableShell>
                  </SectionCard>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <SectionCard title="Jotform Dry Run" action={<Button startIcon={<ScienceOutlined />} onClick={testJotformPayload}>Normalize</Button>}>
                    <Stack spacing={2}>
                      <TextField fullWidth multiline minRows={8} value={testPayload} onChange={(event) => setTestPayload(event.target.value)} />
                      {testResult && (
                        <Box component="pre" sx={{ p: 2, bgcolor: "background.default", borderRadius: 1, overflow: "auto", maxHeight: 320 }}>
                          {JSON.stringify(testResult, null, 2)}
                        </Box>
                      )}
                    </Stack>
                  </SectionCard>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
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
        onReplay={(event) => replayWebhook(event, true)}
        onSaved={async () => {
          notifySuccess("Jotform mapping saved");
          await load();
        }}
      />
      {snackbar}
    </PageStack>
  );
}
