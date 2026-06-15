"use client";

import { AddIcon } from "@/components/ui/icons";
import { ContentCopyOutlined } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import { ExpandLessOutlined } from "@/components/ui/icons";
import { ExpandMoreOutlined } from "@/components/ui/icons";
import { KeyOutlined } from "@/components/ui/icons";
import { PowerSettingsNewOutlined } from "@/components/ui/icons";
import { ReplayOutlined } from "@/components/ui/icons";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { buildRoadmapSummary, type RoadmapCardSummary, type RoadmapStatus } from "@/config/roadmap";
import { formatCurrency, formatHumanLabel, formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  AppDataGrid,
  EmptyState,
  FieldConfig,
  FieldValuePill,
  MutationDialog,
  PageHeader,
  PageStack,
  RowActionMenu,
  SectionCard,
  StatusChip,
  TableShell,
  useNotifier
} from "./common";

const settingsTabs = ["System Health", "Admin Users", "Connected Tools", "Jotform Intake", "Road Map", "Advanced Setup"];
const wizardSteps = ["Summary", "Routing", "Field Mapping", "Preview", "Save"];
const roadmapStatusOrder: RoadmapStatus[] = ["done", "in_progress", "blocked", "planned"];
const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  planned: "Planned",
  blocked: "Blocked"
};
const roadmapVisualLabels: Record<RoadmapCardSummary["visualStatus"], string> = {
  green: "Healthy",
  yellow: "Active",
  red: "Needs attention"
};
const healthToneLabels: Record<string, string> = {
  healthy: "Ready",
  warning: "Needs setup",
  blocked: "Blocked"
};
const healthToneClass: Record<string, string> = {
  healthy: "green",
  warning: "yellow",
  blocked: "red"
};
const smartMappingTargets = [
  "formId",
  "submissionId",
  "cohortSlug",
  "primaryContactName",
  "primaryContactFirstName",
  "primaryContactLastName",
  "primaryContactEmail",
  "primaryContactPhone",
  "organizationName",
  "organizationAddress",
  "organizationCity",
  "organizationState",
  "participantCount",
  "paymentMethod",
  "totalAmount",
  "utmSource",
  "utmCampaign",
  "landingPageUrl",
  "participantText",
  "notes"
];
const requiredMappingTargets = ["formId", "submissionId", "primaryContactName", "primaryContactEmail", "organizationName", "participantCount"];
type JotformFieldOption = {
  key: string;
  label: string;
  rawLabel?: string;
  sampleValue?: string;
};
type JotformTargetField = {
  target: string;
  label: string;
  category: string;
};
type LandingPageRoute = {
  pattern: string;
  cohortId: string;
  label?: string;
};

const roleOptions = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "SALES", "PRESENTER", "VIEWER"].map((value) => ({
  label: formatStatusLabel(value),
  value
}));

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

function TabPanel({ active, index, children }: { active: number; index: number; children: React.ReactNode }) {
  return active === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

function InfoTile({ label, value }: { label: string; value: unknown }) {
  const display = cleanJotformDisplay(value);
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25, minHeight: 62 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography fontWeight={800} sx={{ mt: 0.25, overflowWrap: "anywhere", lineHeight: 1.25 }}>
        {display || "-"}
      </Typography>
    </Box>
  );
}

function compactDate(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function envLabel(key: string) {
  const labels: Record<string, string> = {
    databaseUrl: "Database URL",
    supabaseUrl: "Supabase URL",
    supabaseAnonKey: "Supabase anon key",
    supabaseServiceRoleKey: "Supabase service role key",
    sendgridConfigured: "SendGrid",
    googleCalendarConfigured: "Google Calendar",
    quickBooksConfigured: "QuickBooks",
    sendgridWebhookConfigured: "SendGrid webhook",
    crmConfigured: "CRM handoff",
    muxConfigured: "Mux video",
    authBootstrapConfigured: "Auth bootstrap",
    webhookSecretConfigured: "Webhook secret",
    cronSecretConfigured: "Cron secret",
    appBaseUrlConfigured: "App base URL"
  };

  return labels[key] ?? formatHumanLabel(key);
}

function getFieldMapValue(fieldMap: AdminRow, target: string) {
  return typeof fieldMap[target] === "string" ? fieldMap[target] : "";
}

function fieldOptionByKey(fieldOptions: JotformFieldOption[], key: string) {
  return fieldOptions.find((option) => option.key === key);
}

function cleanFieldMap(fieldMap: AdminRow) {
  return Object.entries(fieldMap).reduce<Record<string, string>>((acc, [target, source]) => {
    if (target.startsWith("__")) {
      return acc;
    }

    if (typeof source === "string" && source.trim()) {
      acc[target] = source;
    }

    return acc;
  }, {});
}

function cleanLandingPageRoutes(routes: LandingPageRoute[]) {
  return routes
    .map((route) => ({
      pattern: route.pattern.trim(),
      cohortId: route.cohortId.trim(),
      label: route.label?.trim() || undefined
    }))
    .filter((route) => route.pattern && route.cohortId);
}

function readLandingPageRoutes(value: unknown): LandingPageRoute[] {
  let parsedValue = value;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const encoded = (value as AdminRow).__landingPageRoutes;

    if (typeof encoded === "string" && encoded.trim()) {
      try {
        parsedValue = JSON.parse(encoded);
      } catch {
        parsedValue = [];
      }
    }
  }

  return Array.isArray(parsedValue)
    ? parsedValue
      .map((route) => {
        const row = route && typeof route === "object" && !Array.isArray(route) ? route as AdminRow : {};
        return {
          pattern: typeof row.pattern === "string" ? row.pattern : "",
          cohortId: typeof row.cohortId === "string" ? row.cohortId : "",
          label: typeof row.label === "string" ? row.label : ""
        };
      })
      .filter((route) => route.pattern || route.cohortId)
    : [];
}

function fieldMapWithLandingPageRoutes(fieldMap: AdminRow, routes: LandingPageRoute[]) {
  const clean = cleanFieldMap(fieldMap);
  const cleanRoutes = cleanLandingPageRoutes(routes);
  delete clean.__landingPageRoutes;

  if (cleanRoutes.length > 0) {
    clean.__landingPageRoutes = JSON.stringify(cleanRoutes);
  }

  return clean;
}

function normalizeUrlForMatch(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function landingPageMatchesPattern(landingPageUrl: string, pattern: string) {
  const normalizedUrl = normalizeUrlForMatch(landingPageUrl);
  const normalizedPattern = normalizeUrlForMatch(pattern);

  if (!normalizedUrl || !normalizedPattern) {
    return false;
  }

  if (normalizedUrl === normalizedPattern || normalizedUrl.includes(normalizedPattern)) {
    return true;
  }

  try {
    const url = new URL(normalizedUrl);
    const patternUrl = new URL(normalizedPattern);
    return url.hostname === patternUrl.hostname && normalizeUrlForMatch(url.pathname) === normalizeUrlForMatch(patternUrl.pathname);
  } catch {
    return false;
  }
}

function matchedLandingPageRoute(landingPageUrl: string, routes: LandingPageRoute[]) {
  const cleanRoutes = cleanLandingPageRoutes(routes);
  const matchedRoute = cleanRoutes.find((route) => landingPageMatchesPattern(landingPageUrl, route.pattern));

  if (matchedRoute) {
    return matchedRoute;
  }

  return cleanRoutes.length === 1 ? cleanRoutes[0] : undefined;
}

function fieldSample(fieldOptions: JotformFieldOption[], key: string) {
  return fieldOptionByKey(fieldOptions, key)?.sampleValue ?? "";
}

function cleanJotformDisplay(value: unknown) {
  if (value == null || value === "") {
    return "";
  }

  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldOptionLabel(option?: JotformFieldOption, fallback = "") {
  return cleanJotformDisplay(option?.label || option?.rawLabel || fallback || option?.key);
}

function fieldOptionSample(option?: JotformFieldOption) {
  return cleanJotformDisplay(option?.sampleValue);
}

function JotformOptionContent({ option }: { option: JotformFieldOption }) {
  return (
    <span className="jotform-field-option">
      <strong>{fieldOptionLabel(option, option.key)}</strong>
      {fieldOptionSample(option) && <span>{fieldOptionSample(option)}</span>}
    </span>
  );
}

function JotformFieldPreview({ option }: { option: JotformFieldOption }) {
  const label = fieldOptionLabel(option, option.key);
  const sample = fieldOptionSample(option);

  return (
    <div className="jotform-field-preview" title={[label, sample].filter(Boolean).join(" - ")}>
      <strong>{label}</strong>
      <span>{sample || "No response"}</span>
    </div>
  );
}

function MappingDisplayRow({
  label,
  option,
  sourceKey,
  sample
}: {
  label: string;
  option?: JotformFieldOption;
  sourceKey: string;
  sample?: unknown;
}) {
  const cleanLabel = cleanJotformDisplay(label);
  const sourceLabel = fieldOptionLabel(option, sourceKey);
  const cleanSample = cleanJotformDisplay(sample ?? option?.sampleValue);
  const title = [cleanLabel, sourceLabel, cleanSample].filter(Boolean).join(" - ");

  return (
    <div className="jotform-mapping-row" title={title}>
      <span className="metadata-pill jotform-mapping-target">
        <span>{cleanLabel}</span>
      </span>
      <div className="jotform-mapping-copy">
        <strong>{sourceLabel || sourceKey || "Not mapped"}</strong>
        {cleanSample && <span>{cleanSample}</span>}
      </div>
    </div>
  );
}

function PreviewTile({ label, value }: { label: string; value: unknown }) {
  const cleanValue = cleanJotformDisplay(value);
  return (
    <div className="jotform-preview-tile" title={cleanValue || undefined}>
      <span>{label}</span>
      <strong>{cleanValue || "-"}</strong>
    </div>
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
  const normalized = preview.normalized ?? {};
  const registration = normalized.registration ?? {};
  const organization = normalized.organization ?? {};
  const payment = normalized.payment ?? {};
  const participants = Array.isArray(normalized.participants) ? normalized.participants : [];
  const fieldOptions: JotformFieldOption[] = Array.isArray(preview.fieldOptions) ? preview.fieldOptions : [];
  const targetFields: JotformTargetField[] = Array.isArray(preview.targetFields) ? preview.targetFields : [];
  const groupedTargets = useMemo(() => {
    return targetFields.reduce<Record<string, JotformTargetField[]>>((acc, target) => {
      const category = target.category ?? "Other";
      acc[category] = [...(acc[category] ?? []), target];
      return acc;
    }, {});
  }, [targetFields]);
  const [sessionCount, setSessionCount] = useState(5);
  const [routingMode, setRoutingMode] = useState<"default" | "slug" | "url">("slug");
  const [defaultCohortId, setDefaultCohortId] = useState("");
  const [landingPageRoutes, setLandingPageRoutes] = useState<LandingPageRoute[]>([]);
  const [label, setLabel] = useState("");
  const [fieldMap, setFieldMap] = useState<AdminRow>({});
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (event) {
      const detectedCount = Number(existingMapping?.sessionCount ?? 5);
      const existingRoutes = readLandingPageRoutes(existingMapping?.fieldMapJson);
      const suggestedLandingPageRoute = preview.landingPageUrl ? [{ pattern: preview.landingPageUrl, cohortId: "", label: "Detected landing page" }] : [];
      const useSlug = Boolean(existingMapping?.requireCohortSlug ?? preview.cohortSlug);
      setSessionCount(detectedCount);
      setRoutingMode(existingRoutes.length ? "url" : preview.landingPageUrl ? "url" : useSlug ? "slug" : "default");
      setDefaultCohortId(existingMapping?.defaultCohortId ?? "");
      setLandingPageRoutes(existingRoutes.length ? existingRoutes : suggestedLandingPageRoute);
      setLabel(existingMapping?.label ?? `Jotform ${preview.formId || "form"} intake`);
      setFieldMap(existingMapping?.fieldMapJson ?? preview.suggestedFieldMap ?? {});
      setActiveStep(0);
      setError(null);
    }
  }, [event, existingMapping, preview.cohortSlug, preview.formId, preview.suggestedFieldMap]);

  function updateFieldMap(target: string, sourceKey: string) {
    setFieldMap((current) => ({ ...current, [target]: sourceKey }));
  }

  function updateLandingPageRoute(index: number, field: keyof LandingPageRoute, value: string) {
    setLandingPageRoutes((current) => current.map((route, routeIndex) => routeIndex === index ? { ...route, [field]: value } : route));
  }

  function replayReadinessIssues() {
    const issues: string[] = [];

    if (routingMode === "default" && !defaultCohortId) {
      issues.push("route");
    }

    if (routingMode === "url") {
      const detectedUrl = cleanJotformDisplay(preview.landingPageUrl);
      const replayRoute = detectedUrl ? matchedLandingPageRoute(detectedUrl, landingPageRoutes) : undefined;

      if (!detectedUrl || !replayRoute) {
        issues.push("route");
      }
    }

    if (routingMode === "slug") {
      const mappedSlug = fieldSample(fieldOptions, getFieldMapValue(fieldMap, "cohortSlug")) || preview.cohortSlug;

      if (!mappedSlug) {
        issues.push("route");
      }
    }

    if (!preview.primaryContactName || !preview.primaryContactEmail) {
      issues.push("POC");
    }

    if (!preview.organizationName) {
      issues.push("organization");
    }

    if (!preview.participantCount && !preview.parsedParticipantCount && participants.length === 0) {
      issues.push("participants");
    }

    return issues;
  }

  async function save({ replayAfterSave = false } = {}) {
    if (!event) {
      return;
    }

    const mappedFormId = fieldSample(fieldOptions, getFieldMapValue(fieldMap, "formId")) || preview.formId;

    if (!mappedFormId) {
      setError("Choose the incoming field that contains the Jotform form ID.");
      return;
    }

    if (routingMode === "default" && !defaultCohortId) {
      setError("Choose a default cohort or switch to cohortSlug routing.");
      return;
    }

    if (routingMode === "url" && cleanLandingPageRoutes(landingPageRoutes).length === 0) {
      setError("Add at least one landing page URL pattern and choose the cohort it should route to.");
      return;
    }

    if (replayAfterSave && routingMode === "url") {
      const detectedUrl = cleanJotformDisplay(preview.landingPageUrl);
      const replayRoute = detectedUrl ? matchedLandingPageRoute(detectedUrl, landingPageRoutes) : undefined;

      if (!detectedUrl) {
        setError("This submission does not include a landing page URL. Use one default cohort for this mapping or map the landing page URL field before replaying.");
        return;
      }

      if (!replayRoute) {
        setError("The detected landing page URL does not match any URL rule. Choose the cohort for this URL before saving and replaying.");
        return;
      }
    }

    if (replayAfterSave && routingMode === "slug") {
      const mappedSlug = fieldSample(fieldOptions, getFieldMapValue(fieldMap, "cohortSlug")) || preview.cohortSlug;
      if (!mappedSlug) {
        setError("This submission does not include a cohort slug. Use URL routing or one default cohort before replaying.");
        return;
      }
    }

    if (replayAfterSave) {
      const readinessIssues = replayReadinessIssues();

      if (readinessIssues.length > 0) {
        setError(`Save & Replay still needs ${readinessIssues.join(", ")} before importing this submission.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await adminApi("/api/jotform/mappings", {
        method: existingMapping ? "PATCH" : "POST",
        body: {
          id: existingMapping?.id,
          formId: preview.formId || mappedFormId,
          label,
          sessionCount,
          defaultCohortId: routingMode === "default" ? defaultCohortId : "",
          requireCohortSlug: routingMode === "slug",
          fieldMapJson: routingMode === "url" ? fieldMapWithLandingPageRoutes(fieldMap, landingPageRoutes) : cleanFieldMap(fieldMap),
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

  const mappedPreviewRows = targetFields
    .map((target) => {
      const sourceKey = getFieldMapValue(fieldMap, target.target);
      return {
        ...target,
        sourceKey,
        sample: sourceKey ? fieldSample(fieldOptions, sourceKey) : ""
      };
    })
    .filter((row) => row.sourceKey);
  const smartTargets = targetFields.filter((target) => smartMappingTargets.includes(target.target));
  const confirmedSmartRows = smartTargets
    .map((target) => {
      const sourceKey = getFieldMapValue(fieldMap, target.target);
      return {
        ...target,
        sourceKey,
        sample: sourceKey ? fieldSample(fieldOptions, sourceKey) : ""
      };
    })
    .filter((row) => row.sourceKey);
  const hasFullNameMapping = Boolean(getFieldMapValue(fieldMap, "primaryContactName"));
  const hasSplitNameMapping = Boolean(getFieldMapValue(fieldMap, "primaryContactFirstName") && getFieldMapValue(fieldMap, "primaryContactLastName"));
  const unresolvedSmartTargets = smartTargets.filter((target) => {
    if ([
      "primaryContactFirstName",
      "primaryContactLastName",
      "cohortSlug",
      "primaryContactPhone",
      "organizationAddress",
      "organizationCity",
      "organizationState",
      "paymentMethod",
      "totalAmount",
      "utmSource",
      "utmCampaign",
      "landingPageUrl",
      "participantText",
      "notes"
    ].includes(target.target)) {
      return false;
    }

    if (target.target === "primaryContactName") {
      return !(hasFullNameMapping || hasSplitNameMapping);
    }

    return requiredMappingTargets.includes(target.target) && !getFieldMapValue(fieldMap, target.target);
  });
  const cleanRoutes = cleanLandingPageRoutes(landingPageRoutes);
  const matchedRoute = routingMode === "url" ? matchedLandingPageRoute(preview.landingPageUrl ?? "", landingPageRoutes) : undefined;
  const matchedRouteCohort = matchedRoute ? cohorts.find((cohort) => cohort.id === matchedRoute.cohortId) : undefined;
  const replayBlockingLabels = new Set(["Route", "POC", "Organization", "Participants"]);
  const readinessChecks = [
    {
      label: "Route",
      ready: routingMode === "url" ? Boolean(matchedRoute) : routingMode === "slug" ? Boolean(preview.cohortSlug || getFieldMapValue(fieldMap, "cohortSlug")) : Boolean(defaultCohortId),
      detail: routingMode === "url"
        ? matchedRoute
          ? `Routes to ${matchedRouteCohort?.title ?? "selected cohort"}`
          : "No URL rule matches this submission yet"
        : routingMode === "slug"
          ? "Cohort slug will be required from Jotform"
          : cohorts.find((cohort) => cohort.id === defaultCohortId)?.title ?? "Default cohort required"
    },
    { label: "POC", ready: Boolean(preview.primaryContactName && preview.primaryContactEmail), detail: preview.primaryContactEmail || "Name and email required" },
    { label: "Organization", ready: Boolean(preview.organizationName), detail: preview.organizationName || "Organization name required" },
    { label: "Participants", ready: Boolean(preview.participantCount || preview.parsedParticipantCount), detail: `${preview.parsedParticipantCount ?? 0}${preview.participantCount ? ` / ${preview.participantCount}` : ""} detected` },
    { label: "Payment", ready: Boolean(registration.paymentStatus || registration.totalAmount || payment.status || payment.amount), detail: `${payment.status || registration.paymentStatus || "No status"} · ${payment.amount || registration.totalAmount ? formatCurrency(payment.amount ?? registration.totalAmount) : "$0"}` },
    { label: "Source", ready: Boolean(preview.landingPageUrl || registration.utmSource || registration.utmCampaign), detail: preview.landingPageUrl || registration.utmCampaign || registration.utmSource || "No source captured" }
  ];
  const replayBlockers = readinessChecks.filter((item) => replayBlockingLabels.has(item.label) && !item.ready);
  const canSaveAndReplay = Boolean(event) && event?.reviewStatus !== "PROCESSED" && replayBlockers.length === 0;

  return (
    <Dialog open={Boolean(event)} onClose={onClose} fullWidth maxWidth="xl" PaperProps={{ className: "jotform-mapping-dialog", sx: { minHeight: "82vh" } }}>
      <DialogTitle>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
          <Box>
            <Typography variant="h3">Map Jotform Submission</Typography>
            <Typography color="text.secondary" variant="body2">
              Match Jotform fields to Mission Control fields, then save and replay.
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
            {readiness.recommendedAction && <Alert severity={event.reviewStatus === "FAILED" ? "error" : "info"}>{readiness.recommendedAction}</Alert>}

            {activeStep === 0 && (
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Form ID" value={preview.formId} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Submission ID" value={preview.submissionId} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="POC" value={formatProperDisplay(preview.primaryContactName) || preview.primaryContactEmail} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Organization" value={formatProperDisplay(preview.organizationName)} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Cohort Route" value={preview.cohortSlug || registration.cohortId || "Needs routing"} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Participants" value={`${preview.parsedParticipantCount ?? 0}${preview.participantCount ? ` / ${preview.participantCount}` : ""}`} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Payment" value={[registration.paymentMethod, registration.paymentStatus].filter(Boolean).join(" / ")} /></Grid>
                <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Amount" value={registration.totalAmount ? formatCurrency(registration.totalAmount) : ""} /></Grid>
              </Grid>
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
                  <TextField select fullWidth label="Routing mode" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as "default" | "slug" | "url")}>
                    <MenuItem value="url">Route by landing page URL</MenuItem>
                    <MenuItem value="default">Use one default cohort</MenuItem>
                    <MenuItem value="slug">Require cohortSlug from Jotform URL</MenuItem>
                  </TextField>
                </Grid>
                {routingMode === "url" && (
                  <Grid size={{ xs: 12 }}>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} sx={{ mb: 1.5 }}>
                        <Box>
                          <Typography variant="h4">Landing page routing</Typography>
                          <Typography color="text.secondary" variant="body2">
                            Use this for shared Jotforms. Mission Control checks the submitted page URL and routes to the matching cohort.
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddIcon />}
                          onClick={() => setLandingPageRoutes((current) => [...current, { pattern: preview.landingPageUrl || "", cohortId: "", label: "" }])}
                        >
                          Add URL Rule
                        </Button>
                      </Stack>
                      <Stack spacing={1.25}>
                        {preview.landingPageUrl && (
                          <Alert severity={matchedRoute ? "success" : "warning"}>
                            {matchedRoute
                              ? `Detected URL routes to ${matchedRouteCohort?.title ?? "the selected cohort"}.`
                              : "Detected URL does not match any saved URL rule yet."}
                          </Alert>
                        )}
                        {landingPageRoutes.map((route, index) => (
                          <Grid container spacing={1} alignItems="center" key={`${route.pattern}-${index}`}>
                            <Grid size={{ xs: 12, md: 5 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="URL pattern"
                                value={route.pattern}
                                placeholder="rocketpd.com/cohorts/building-thinking-classrooms"
                                onChange={(event) => updateLandingPageRoute(index, "pattern", event.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                select
                                fullWidth
                                size="small"
                                label="Route to cohort"
                                value={route.cohortId}
                                onChange={(event) => updateLandingPageRoute(index, "cohortId", event.target.value)}
                              >
                                {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
                              </TextField>
                            </Grid>
                            <Grid size={{ xs: 12, md: 2 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Label"
                                value={route.label ?? ""}
                                placeholder="Peter fall page"
                                onChange={(event) => updateLandingPageRoute(index, "label", event.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 1 }}>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                onClick={() => setLandingPageRoutes((current) => current.filter((_route, routeIndex) => routeIndex !== index))}
                              >
                                Remove
                              </Button>
                            </Grid>
                          </Grid>
                        ))}
                        {landingPageRoutes.length === 0 && (
                          <EmptyState title="No URL rules yet" description="Add one URL pattern for each cohort page that shares this Jotform." />
                        )}
                      </Stack>
                    </Paper>
                  </Grid>
                )}
                {routingMode === "default" && (
                  <Grid size={{ xs: 12 }}>
                    <TextField select fullWidth label="Default cohort" value={defaultCohortId} onChange={(event) => setDefaultCohortId(event.target.value)}>
                      {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
                    </TextField>
                  </Grid>
                )}
              </Grid>
            )}

            {activeStep === 2 && (
              <Stack spacing={2}>
                <Alert severity={unresolvedSmartTargets.length ? "warning" : "success"}>
                  {unresolvedSmartTargets.length
                    ? `Mission Control mapped ${confirmedSmartRows.length} fields. Review the ${unresolvedSmartTargets.length} unresolved field${unresolvedSmartTargets.length === 1 ? "" : "s"} below.`
                    : `Mission Control mapped ${confirmedSmartRows.length} fields confidently. You can continue or open Advanced field mapping for edge cases.`}
                </Alert>

                {unresolvedSmartTargets.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="h4" sx={{ mb: 1.5 }}>Needs review</Typography>
                    <Grid container spacing={1.5}>
                      {unresolvedSmartTargets.map((target) => (
                        <Grid size={{ xs: 12, md: 6 }} key={target.target}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label={target.label}
                            value={getFieldMapValue(fieldMap, target.target)}
                            onChange={(event) => updateFieldMap(target.target, event.target.value)}
                          >
                            <MenuItem value="">Do not map</MenuItem>
                            {fieldOptions.map((option) => (
                              <MenuItem value={option.key} label={fieldOptionLabel(option, option.key)} key={`${target.target}-${option.key}`} sx={{ minHeight: 46 }}>
                                <JotformOptionContent option={option} />
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                      ))}
                    </Grid>
                  </Paper>
                )}

                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="h4" sx={{ mb: 1.5 }}>Confirmed mappings</Typography>
                  <Grid container spacing={1}>
                    {confirmedSmartRows.map((row) => (
                      <Grid size={{ xs: 12, md: 6 }} key={row.target}>
                        <MappingDisplayRow
                          label={row.label}
                          option={fieldOptionByKey(fieldOptions, row.sourceKey)}
                          sourceKey={row.sourceKey}
                          sample={row.sample || "-"}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Paper>

                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                    <Box>
                      <Typography variant="h4">Advanced field mapping</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Open only if a field was matched incorrectly or this Jotform version changed.
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      {Object.entries(groupedTargets).map(([category, targets]) => (
                        <Paper variant="outlined" sx={{ p: 1.5 }} key={category}>
                          <Typography variant="h4" sx={{ mb: 1.5 }}>{category}</Typography>
                          <Grid container spacing={1.5}>
                            {targets.map((target) => (
                              <Grid size={{ xs: 12, md: 6 }} key={target.target}>
                                <TextField
                                  select
                                  fullWidth
                                  size="small"
                                  label={target.label}
                                  value={getFieldMapValue(fieldMap, target.target)}
                                  onChange={(event) => updateFieldMap(target.target, event.target.value)}
                                >
                                  <MenuItem value="">Do not map</MenuItem>
                                  {fieldOptions.map((option) => (
                                    <MenuItem value={option.key} label={fieldOptionLabel(option, option.key)} key={`${target.target}-${option.key}`}>
                                      <JotformOptionContent option={option} />
                                    </MenuItem>
                                  ))}
                                </TextField>
                              </Grid>
                            ))}
                          </Grid>
                        </Paper>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            )}

            {activeStep === 3 && (
              <Stack spacing={2}>
                <div className="jotform-preview-grid">
                  <PreviewTile label="Registration POC" value={[formatProperDisplay(registration.primaryContactName), registration.primaryContactEmail].filter(Boolean).join(" - ")} />
                  <PreviewTile label="Organization" value={formatProperDisplay(organization.name)} />
                  <PreviewTile label="Cohort route" value={preview.cohortSlug || registration.cohortId || "Selected by mapping"} />
                  <PreviewTile label="Participant roster" value={`${participants.length} parsed from submission`} />
                  <PreviewTile label="Payment record" value={`${payment.method || registration.paymentMethod || "Unknown"} / ${payment.status || registration.paymentStatus || "Unknown"}`} />
                  <PreviewTile label="Amount" value={payment.amount ? formatCurrency(payment.amount) : "$0"} />
                </div>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="h4" sx={{ mb: 1 }}>Selected field matches</Typography>
                  <Grid container spacing={1}>
                    {mappedPreviewRows.map((row) => (
                      <Grid size={{ xs: 12, md: 6 }} key={row.target}>
                        <MappingDisplayRow
                          label={row.label}
                          option={fieldOptionByKey(fieldOptions, row.sourceKey)}
                          sourceKey={row.sourceKey}
                          sample={row.sample || "-"}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Paper>
              </Stack>
            )}

            {activeStep === 4 && (
              <Stack spacing={2}>
                <Alert severity="info">
                  Saving stores this form mapping for future submissions. Save & Replay will immediately reprocess this held submission using the selected fields.
                </Alert>
                {replayBlockers.length > 0 && (
                  <Alert severity="warning">
                    Replay is paused until {replayBlockers.map((item) => item.label.toLowerCase()).join(", ")} {replayBlockers.length === 1 ? "is" : "are"} ready.
                  </Alert>
                )}
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="h4" sx={{ mb: 1 }}>Import readiness checklist</Typography>
                  <Grid container spacing={1}>
                    {readinessChecks.map((item) => (
                      <Grid size={{ xs: 12, md: 6 }} key={item.label}>
                        <FieldValuePill
                          label={`${item.ready ? "Ready" : "Needs review"} · ${item.label}`}
                          value={item.detail}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Paper>
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Mapping" value={label} /></Grid>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Session count" value={`${sessionCount} sessions`} /></Grid>
                  <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Routing" value={routingMode === "url" ? "Landing page URL rules" : routingMode === "slug" ? "Requires cohortSlug" : "Default cohort"} /></Grid>
                  {routingMode === "url" && (
                    <Grid size={{ xs: 12 }}>
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography variant="h4" sx={{ mb: 1 }}>URL rules that will be saved</Typography>
                        <Grid container spacing={1}>
                          {cleanRoutes.map((route) => (
                            <Grid size={{ xs: 12, md: 6 }} key={`${route.pattern}-${route.cohortId}`}>
                              <FieldValuePill
                                label={route.label || "Landing page"}
                                value={`${route.pattern} -> ${cohorts.find((cohort) => cohort.id === route.cohortId)?.title ?? "Selected cohort"}`}
                              />
                            </Grid>
                          ))}
                        </Grid>
                      </Paper>
                    </Grid>
                  )}
                </Grid>
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" size="small" onClick={onClose}>Cancel</Button>
        <Button variant="outlined" size="small" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>Back</Button>
        {activeStep < wizardSteps.length - 1 ? (
          <Button size="small" onClick={() => setActiveStep((step) => Math.min(wizardSteps.length - 1, step + 1))}>Next</Button>
        ) : (
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
            <Button variant="outlined" size="small" onClick={() => save()} disabled={saving}>{saving ? "Saving" : "Save Mapping"}</Button>
            <Button size="small" onClick={() => save({ replayAfterSave: true })} disabled={saving || !canSaveAndReplay}>
              {saving ? "Working" : "Save & Replay"}
            </Button>
          </Stack>
        )}
      </DialogActions>
    </Dialog>
  );
}

function JotformSubmissionRow({
  row,
  onReview,
  onReplay
}: {
  row: AdminRow;
  onReview: (row: AdminRow) => void;
  onReplay: (row: AdminRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = row.preview ?? {};
  const readiness = row.readiness ?? {};
  const registration = preview.normalized?.registration ?? {};
  const participants = Array.isArray(preview.normalized?.participants) ? preview.normalized.participants : [];
  const fieldOptions: JotformFieldOption[] = Array.isArray(preview.fieldOptions) ? preview.fieldOptions : [];
  const status = row.reviewStatus ?? row.status;
  const revision = row.revision ?? {};
  const organization = formatProperDisplay(preview.organizationName) || "Unknown organization";
  const contact = formatProperDisplay(preview.primaryContactName) || preview.primaryContactEmail || "Unknown POC";
  const canReplay = Boolean(readiness.canReplay) && status !== "PROCESSED";
  const replayButtonLabel = status === "PROCESSED" ? "Imported" : canReplay ? "Replay" : "Map first";

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Grid
        container
        spacing={1}
        alignItems="center"
        sx={{ p: 1, cursor: "pointer", bgcolor: expanded ? "background.default" : "background.paper" }}
        onClick={() => setExpanded((current) => !current)}
      >
        <Grid size={{ xs: 12, md: 1.4 }}><StatusChip value={status} /></Grid>
        <Grid size={{ xs: 12, md: 2.2 }}>
          <Typography fontWeight={800} sx={{ overflowWrap: "anywhere" }}>{organization}</Typography>
          {revision.revisionNumber && <Typography variant="caption" color="text.secondary">Revision {revision.revisionNumber}{revision.isRevision ? " · update" : " · first import"}</Typography>}
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Typography sx={{ overflowWrap: "anywhere" }}>{contact}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{preview.primaryContactEmail}</Typography>
        </Grid>
        <Grid size={{ xs: 6, md: 1.4 }}><Typography>{preview.cohortSlug || registration.cohortId || "Needs route"}</Typography></Grid>
        <Grid size={{ xs: 6, md: 1.1 }}><Typography>{preview.parsedParticipantCount ?? 0}{preview.participantCount ? ` / ${preview.participantCount}` : ""}</Typography></Grid>
        <Grid size={{ xs: 6, md: 1.4 }}><Typography>{[formatStatusLabel(registration.paymentMethod), formatStatusLabel(registration.paymentStatus)].filter((item) => item !== "Unknown").join(" / ") || "-"}</Typography></Grid>
        <Grid size={{ xs: 6, md: 1 }}><Typography>{compactDate(row.createdAt)}</Typography></Grid>
        <Grid size={{ xs: 12, md: 1.5 }}>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} justifyContent={{ xs: "flex-start", md: "flex-end" }} onClick={(event) => event.stopPropagation()}>
            <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={() => onReview(row)}>Map</Button>
            <Button size="small" variant="outlined" startIcon={<ReplayOutlined />} disabled={!canReplay} onClick={() => onReplay(row)}>{replayButtonLabel}</Button>
            <IconButton size="small" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Collapse" : "Expand"}>
              {expanded ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
            </IconButton>
          </Stack>
        </Grid>
      </Grid>
      <Collapse in={expanded}>
        <Stack spacing={1.5} sx={{ p: 1.5, borderTop: 1, borderColor: "divider", bgcolor: "background.default" }}>
          {(readiness.recommendedAction || row.errorMessage) && (
            <Alert severity={status === "FAILED" ? "error" : status === "PROCESSED" ? "success" : "info"}>
              {row.errorMessage || readiness.recommendedAction}
            </Alert>
          )}
          {Array.isArray(readiness.missingRequiredFields) && readiness.missingRequiredFields.length > 0 && (
            <Alert severity="warning">
              Missing before replay: {readiness.missingRequiredFields.join(", ")}.
            </Alert>
          )}
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Form ID" value={preview.formId || "Missing"} /></Grid>
            <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Submission ID" value={preview.submissionId} /></Grid>
            <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Revision" value={revision.revisionNumber ? `Revision ${revision.revisionNumber}${revision.isRevision ? " update" : " first import"}` : "Not imported yet"} /></Grid>
            <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Amount" value={registration.totalAmount ? formatCurrency(registration.totalAmount) : ""} /></Grid>
            <Grid size={{ xs: 12, md: 3 }}><InfoTile label="Field matches" value={`${preview.fieldOptions?.length ?? 0} incoming fields detected`} /></Grid>
          </Grid>
          {participants.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Participants detected
              </Typography>
              <Grid container spacing={1}>
                {participants.slice(0, 6).map((participant: AdminRow, index: number) => (
                  <Grid size={{ xs: 12, md: 6 }} key={`${participant.email}-${index}`}>
                    <FieldValuePill
                      label={`${formatProperDisplay(`${participant.firstName ?? ""} ${participant.lastName ?? ""}`) || `Participant ${index + 1}`}`}
                      value={participant.email}
                      secondary={participant.title}
                    />
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}
          {fieldOptions.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Incoming field preview
              </Typography>
              <Grid container spacing={1}>
                {fieldOptions.slice(0, 12).map((option) => (
                  <Grid size={{ xs: 12, md: 6 }} key={option.key}>
                    <JotformFieldPreview option={option} />
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" startIcon={<EditOutlined />} onClick={() => onReview(row)}>Review & Map Fields</Button>
            <Button size="small" variant="outlined" startIcon={<ReplayOutlined />} disabled={!canReplay} onClick={() => onReplay(row)}>{canReplay ? "Replay Submission" : replayButtonLabel}</Button>
          </Stack>
        </Stack>
      </Collapse>
    </Paper>
  );
}

function RoadmapProgressBar({ value, tone }: { value: number; tone: RoadmapCardSummary["visualStatus"] }) {
  return (
    <div className="roadmap-progress" aria-label={`${value}% complete`}>
      <span className={`roadmap-progress-fill is-${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function RoadmapSummaryTile({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <div className="roadmap-summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </div>
  );
}

function RoadmapItemRow({ item }: { item: RoadmapCardSummary["items"][number] }) {
  return (
    <li className="roadmap-item">
      <span className={`roadmap-item-status is-${item.status}`}>{roadmapStatusLabels[item.status]}</span>
      <div>
        <strong>{item.title}</strong>
        {item.note ? <p>{item.note}</p> : null}
      </div>
      {item.priority ? <span className="roadmap-priority">{formatStatusLabel(item.priority)}</span> : null}
    </li>
  );
}

function RoadmapCardView({
  card,
  expanded,
  onToggle
}: {
  card: RoadmapCardSummary;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const groupedItems = roadmapStatusOrder
    .map((status) => ({
      status,
      items: card.items.filter((item) => item.status === status)
    }))
    .filter((group) => group.items.length > 0);

  return (
    <article className={`roadmap-card is-${card.visualStatus}`}>
      <div className="roadmap-card-header">
        <div className="roadmap-card-title">
          <span>{card.ownerArea}</span>
          <h3>{card.title}</h3>
          <p>{card.summary}</p>
        </div>
        <span className={`roadmap-status-badge is-${card.visualStatus}`}>{roadmapVisualLabels[card.visualStatus]}</span>
      </div>

      <div className="roadmap-card-meter">
        <strong>{card.completion}%</strong>
        <RoadmapProgressBar value={card.completion} tone={card.visualStatus} />
      </div>

      <div className="roadmap-counts" aria-label={`${card.title} roadmap item counts`}>
        {roadmapStatusOrder.map((status) => (
          <span className={`roadmap-count-pill is-${status}`} key={status}>
            <b>{card.counts[status]}</b>
            {roadmapStatusLabels[status]}
          </span>
        ))}
      </div>

      <Button
        size="small"
        variant="outlined"
        endIcon={expanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
        onClick={() => onToggle(card.id)}
      >
        {expanded ? "Hide details" : "View details"}
      </Button>

      {expanded ? (
        <div className="roadmap-card-body">
          {groupedItems.map((group) => (
            <section className="roadmap-item-group" key={group.status}>
              <h4>{roadmapStatusLabels[group.status]}</h4>
              <ul className="roadmap-item-list">
                {group.items.map((item) => (
                  <RoadmapItemRow item={item} key={`${group.status}-${item.title}`} />
                ))}
              </ul>
            </section>
          ))}
          <div className="roadmap-next-action">
            <span>Next</span>
            <p>{card.nextAction}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function RoadmapPanel() {
  const roadmap = useMemo(() => buildRoadmapSummary(), []);
  const [expandedRoadmapCards, setExpandedRoadmapCards] = useState<Set<string>>(
    () => new Set(["jotform-intake", "finance-distribution", "platform-qa-deployment"])
  );
  const overallTone: RoadmapCardSummary["visualStatus"] =
    roadmap.overallCompletion >= 80 ? "green" : roadmap.overallCompletion >= 35 ? "yellow" : "red";

  function toggleRoadmapCard(id: string) {
    setExpandedRoadmapCards((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <SectionCard title="Road Map" action={<StatusChip value="CODE OWNED" />}>
      <div className="roadmap-intro">
        <div>
          <h2>Mission Control north star</h2>
          <p>
            A curated product and operations plan for what is working, what is active, what is blocked, and what is scheduled next.
            This v1 is read-only in the app and updated through normal GitHub deployments.
          </p>
        </div>
        <div className="roadmap-overall">
          <strong>{roadmap.overallCompletion}%</strong>
          <span>overall completion</span>
          <RoadmapProgressBar value={roadmap.overallCompletion} tone={overallTone} />
        </div>
      </div>

      <div className="roadmap-summary-grid">
        <RoadmapSummaryTile label="Completed" value={roadmap.counts.done} helper="Items already working or materially shipped" />
        <RoadmapSummaryTile label="In progress" value={roadmap.counts.in_progress} helper="Active build or polish work" />
        <RoadmapSummaryTile label="Blocked" value={roadmap.counts.blocked} helper="Needs migration, access, or decision" />
        <RoadmapSummaryTile label="Planned" value={roadmap.counts.planned} helper="Queued future development" />
        <RoadmapSummaryTile label="Total scope" value={roadmap.totalItems} helper="Current roadmap checklist items" />
      </div>

      <div className="roadmap-layout">
        {roadmap.cards.map((card) => (
          <RoadmapCardView
            card={card}
            expanded={expandedRoadmapCards.has(card.id)}
            key={card.id}
            onToggle={toggleRoadmapCard}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function HealthBadge({ status }: { status?: string }) {
  const normalized = String(status ?? "warning");
  return <span className={`roadmap-status-badge is-${healthToneClass[normalized] ?? "yellow"}`}>{healthToneLabels[normalized] ?? formatStatusLabel(normalized)}</span>;
}

function SystemHealthPanel({ systemHealth, legacyHealth }: { systemHealth: AdminRow | null; legacyHealth: AdminRow | null }) {
  const groups = (systemHealth?.groups ?? []) as AdminRow[];
  const generatedAt = systemHealth?.generatedAt ? new Date(systemHealth.generatedAt).toLocaleString() : null;

  if (!systemHealth) {
    const env = legacyHealth?.env ?? {};

    return (
      <SectionCard title="System Health" action={<StatusChip value={legacyHealth?.database ? "CONNECTED" : "UNAVAILABLE"} />}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Full deployment readiness is unavailable. Showing the legacy environment check instead.
        </Alert>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, md: 4 }}><InfoTile label="Database" value={legacyHealth?.database ? "Connected" : "Unavailable"} /></Grid>
          {Object.entries(env).map(([key, value]) => (
            <Grid size={{ xs: 12, md: 4 }} key={key}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25, minHeight: 54 }}>
                <Typography>{envLabel(key)}</Typography>
                <StatusChip value={Boolean(value)} />
              </Stack>
            </Grid>
          ))}
        </Grid>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="System Health" action={<HealthBadge status={systemHealth.status} />}>
      <div className="system-health-intro">
        <div>
          <h2>Deployment readiness</h2>
          <p>
            Checks the production-critical schema, storage, and integration setup needed to keep Mission Control from crashing when new features ship.
          </p>
        </div>
        <div className="system-health-generated">
          <span>Last checked</span>
          <strong>{generatedAt ?? "-"}</strong>
        </div>
      </div>

      <div className="system-health-grid">
        {groups.map((group) => {
          const checks = (group.checks ?? []) as AdminRow[];
          const ready = checks.filter((check) => check.status === "healthy").length;
          const blocked = checks.filter((check) => check.status === "blocked").length;

          return (
            <article className={`system-health-card is-${healthToneClass[String(group.status)] ?? "yellow"}`} key={group.key}>
              <div className="system-health-card-header">
                <div>
                  <span>{group.summary}</span>
                  <h3>{group.title}</h3>
                </div>
                <HealthBadge status={String(group.status)} />
              </div>
              <div className="system-health-card-meter">
                <strong>{ready}/{checks.length}</strong>
                <span>ready checks · {blocked} blocked</span>
              </div>
              <ul className="system-health-checks">
                {checks.map((check) => (
                  <li className={`system-health-check is-${healthToneClass[String(check.status)] ?? "yellow"}`} key={check.key}>
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                      {check.nextAction ? <em>{check.nextAction}</em> : null}
                    </div>
                    <HealthBadge status={String(check.status)} />
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function SettingsClient() {
  const [activeTab, setActiveTab] = useState(0);
  const [health, setHealth] = useState<AdminRow | null>(null);
  const [systemHealth, setSystemHealth] = useState<AdminRow | null>(null);
  const [users, setUsers] = useState<AdminRow[]>([]);
  const [mappings, setMappings] = useState<AdminRow[]>([]);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<AdminRow | null>(null);
  const [jotformSetup, setJotformSetup] = useState<AdminRow | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<AdminRow[]>([]);
  const [mappingWizardEvent, setMappingWizardEvent] = useState<AdminRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminRow | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [healthData, systemHealthData, userRows, mappingRows, cohortRows, integrationRows, intakeData] = await Promise.all([
      adminApi<AdminRow>("/api/health"),
      adminApi<AdminRow>("/api/system-health").catch(() => null),
      adminApi<AdminRow[]>("/api/users").catch(() => []),
      adminApi<AdminRow[]>("/api/jotform/mappings").catch(() => []),
      adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
      adminApi<AdminRow>("/api/integrations/status").catch(() => null),
      adminApi<AdminRow>("/api/jotform/intake").catch(() => ({ setup: null, events: [] }))
    ]);
    setHealth(healthData);
    setSystemHealth(systemHealthData);
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
  const currentWizardMapping = mappingWizardEvent
    ? mappings.find((mapping) => mapping.formId === mappingWizardEvent.preview?.formId)
    : undefined;
  const providers: Array<[string, string, unknown, string]> = [
    ["Google Calendar", "Shared operations calendar for cohort sessions.", env.googleCalendarConfigured, "/api/integrations/google/connect"],
    ["QuickBooks", "Financial reporting status sync for invoices and payments.", env.quickBooksConfigured, "/api/integrations/quickbooks/connect"],
    ["SendGrid Email", "Confirmation, reminder, and resend email delivery.", env.sendgridConfigured, ""],
    ["CRM Handoff", "Outbound contact and registration updates to RocketPD CRM.", env.crmConfigured, ""],
    ["Mux Video", "Session recording and lightweight resource playback.", env.muxConfigured, ""],
    ["Jotform Intake", "Registration submissions, mapping, and replay queue.", Boolean(jotformSetup?.configured || env.webhookSecretConfigured), ""]
  ];

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
    { field: "formId", headerName: "Form ID", width: 150 },
    { field: "sessionCount", headerName: "Sessions", width: 100 },
    {
      field: "defaultCohort",
      headerName: "Routing",
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, row) => {
        const routeCount = readLandingPageRoutes(row.fieldMapJson).length;

        if (routeCount > 0) {
          return `${routeCount} landing page URL rule${routeCount === 1 ? "" : "s"}`;
        }

        return row.defaultCohort?.title ?? "Requires cohortSlug";
      }
    },
    { field: "active", headerName: "Active", width: 110, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit mapping", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              { label: params.row.active ? "Disable mapping" : "Enable mapping", icon: <PowerSettingsNewOutlined fontSize="small" />, onClick: () => toggleMapping(params.row) }
            ]}
          />
        </Box>
      )
    }
  ];
  const userColumns: GridColDef[] = [
    { field: "name", headerName: "User", flex: 1, minWidth: 180, valueGetter: (_value, row) => `${formatProperDisplay(row.firstName)} ${formatProperDisplay(row.lastName)}`.trim() },
    { field: "email", headerName: "Email", flex: 1.2, minWidth: 240 },
    { field: "role", headerName: "Role", width: 150, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "active", headerName: "Active", width: 110, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "updatedAt", headerName: "Updated", width: 160, valueFormatter: (value) => value ? new Date(value).toLocaleString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit user", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingUser(params.row); setUserDialogOpen(true); } },
              { label: params.row.active ? "Disable user" : "Enable user", icon: <PowerSettingsNewOutlined fontSize="small" />, onClick: () => toggleUser(params.row) }
            ]}
          />
        </Box>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader title="System Configuration" description="Runtime health, admin access, integrations, and Jotform intake setup." />
      <Paper variant="outlined" sx={{ px: 1 }}>
        <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)} variant="scrollable" scrollButtons="auto">
          {settingsTabs.map((tab) => <Tab label={tab} key={tab} />)}
        </Tabs>
      </Paper>

      <TabPanel active={activeTab} index={0}>
        <SystemHealthPanel systemHealth={systemHealth} legacyHealth={health} />
      </TabPanel>

      <TabPanel active={activeTab} index={1}>
        <SectionCard title="Admin Users" action={<Button size="small" startIcon={<AddIcon />} onClick={() => setUserDialogOpen(true)}>Add User</Button>}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Users authenticate through Supabase Auth. Mission Control roles and active status control internal authorization.
          </Typography>
          <TableShell>
            <AppDataGrid rows={users} columns={userColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
          </TableShell>
        </SectionCard>
      </TabPanel>

      <TabPanel active={activeTab} index={2}>
        <SectionCard title="Integration Hub">
          <Grid container spacing={1.5}>
            {providers.map(([label, description, configured, href]) => (
              <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={String(label)}>
                <Stack spacing={1} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, minHeight: 104 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={800}>{label}</Typography>
                    <StatusChip value={Boolean(configured)} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {description}
                  </Typography>
                  {href && <Button size="small" variant="outlined" href={String(href)}>Connect</Button>}
                </Stack>
              </Grid>
            ))}
          </Grid>
        </SectionCard>
      </TabPanel>

      <TabPanel active={activeTab} index={3}>
        <Stack spacing={2}>
          <SectionCard
            title="Connection"
            action={
              <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
                <Button size="small" variant="outlined" startIcon={<ContentCopyOutlined />} onClick={copyJotformWebhookUrl}>
                  Copy URL
                </Button>
                <Button size="small" startIcon={<KeyOutlined />} onClick={rotateJotformSecret}>
                  Generate / Rotate Secret
                </Button>
              </Stack>
            }
          >
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "flex-start", md: "center" }}>
                <Typography color="text.secondary" sx={{ flex: 1 }}>
                  Mission Control generates the protected webhook URL for Jotform. Use the copied URL in Jotform, then review incoming test submissions below.
                </Typography>
                <StatusChip value={jotformSetup?.configured ? "CONFIGURED" : "NEEDS SECRET"} />
              </Stack>
              <TextField
                fullWidth
                size="small"
                label="Jotform webhook URL"
                value={jotformSetup?.webhookUrl ?? "Generate a Jotform secret to create the webhook URL"}
                InputProps={{ readOnly: true }}
              />
            </Stack>
          </SectionCard>

          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Box>
                <Typography variant="h3">Review Queue</Typography>
                <Typography color="text.secondary" variant="body2">
                  Review compact rows, expand only when you need details, then map and replay.
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {webhookEvents.length === 0 ? (
                <EmptyState
                  title="No Jotform submissions received yet"
                  description="Paste the webhook URL into Jotform and send a test submission. It will show up here for review."
                />
              ) : (
                <Stack spacing={1}>
                  <Grid container spacing={1} sx={{ px: 1, display: { xs: "none", md: "flex" } }}>
                    {["Status", "Organization", "POC", "Cohort", "Participants", "Payment", "Received", "Actions"].map((label) => (
                      <Grid size={label === "Organization" ? 2.2 : label === "POC" ? 2 : label === "Actions" ? 1.5 : label === "Status" ? 1.4 : label === "Payment" ? 1.4 : label === "Received" ? 1 : 1.1} key={label}>
                        <Typography variant="caption" color="text.secondary" fontWeight={800}>{label}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                  {webhookEvents.map((row) => (
                    <JotformSubmissionRow
                      row={row}
                      key={row.id}
                      onReview={setMappingWizardEvent}
                      onReplay={(event) => { void replayWebhook(event); }}
                    />
                  ))}
                </Stack>
              )}
            </AccordionDetails>
          </Accordion>
        </Stack>
      </TabPanel>

      <TabPanel active={activeTab} index={4}>
        <RoadmapPanel />
      </TabPanel>

      <TabPanel active={activeTab} index={5}>
        <SectionCard title="Mapping Library" action={<Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>Add Mapping</Button>}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Most mapping should happen from the Jotform review wizard. Use this table only for quick enable/disable or routing edits.
          </Typography>
          <TableShell>
            <AppDataGrid rows={mappings} columns={mappingColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
          </TableShell>
        </SectionCard>
      </TabPanel>

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
