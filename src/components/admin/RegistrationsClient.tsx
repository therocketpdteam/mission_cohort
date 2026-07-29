"use client";

import { AddIcon } from "@/components/ui/icons";
import { ArchiveOutlined } from "@/components/ui/icons";
import { CancelOutlined } from "@/components/ui/icons";
import { CheckCircleOutline } from "@/components/ui/icons";
import { DeleteOutline } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import { ExpandMoreOutlined } from "@/components/ui/icons";
import { HelpOutline } from "@/components/ui/icons";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from "@/components/ui/primitives";
import { GridColDef, GridRowParams, GridRowSelectionModel } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { pricePerParticipantForCohort, registrationTotalForCohort, sessionCountForPricing } from "@/config/cohortPricing";
import { formatProperDisplay, formatRegistrationPaymentStatus, formatRegistrationSource, formatStatusLabel } from "@/lib/formatting";
import { RosterWorkbench } from "./RosterWorkbench";
import { RegistrationPendingChangesPanel } from "./RegistrationPendingChangesPanel";
import { RegistrationDeliveryPreflight } from "./RegistrationDeliveryPreflight";
import { PocCommunicationHistory } from "./PocCommunicationHistory";
import { RegistrationCommunicationJourney } from "./RegistrationCommunicationJourney";
import type { ParsedRosterParticipant } from "@/lib/rosterParser";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  EmptyState,
  PageHeader,
  PageStack,
  QuickViewDrawer,
  RowActionMenu,
  SectionCard,
  SourcePill,
  StatusChip,
  TableShell,
  ToolbarButton,
  useNotifier
} from "./common";

const paymentMethods = ["CREDIT_CARD", "PURCHASE_ORDER", "INVOICE", "COMPED", "UNKNOWN"];
const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];
const rosterStatuses = ["NOT_REQUESTED", "NEEDED", "PARTIAL", "COMPLETE"];
const visibilityOptions = [
  { value: "active", label: "Active registrations" },
  { value: "archived", label: "Archived registrations" },
  { value: "all", label: "All registrations" }
];

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function splitName(name?: string | null) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || parts[0] || ""
  };
}

function rosterStatusFromCounts(registration: AdminRow) {
  const expected = Number(registration.participantCount ?? 0);
  const actual = Number(registration.participants?.length ?? registration._count?.participants ?? 0);

  if (expected === 0 && actual === 0) {
    return "NOT_REQUESTED";
  }
  if (expected === 0 || actual >= expected) {
    return "COMPLETE";
  }
  if (actual > 0) {
    return "PARTIAL";
  }
  return "NEEDED";
}

function rosterHealth(registration: AdminRow) {
  const expected = Number(registration.participantCount ?? 0);
  const actual = Number(registration.participants?.length ?? registration._count?.participants ?? 0);
  const status = rosterStatusFromCounts(registration);

  if (status === "COMPLETE") {
    return { tone: "success", label: "Roster complete", helper: `${actual}/${expected || actual} participants` };
  }

  if (actual > 0 && expected > 0 && actual < expected) {
    return { tone: "warning", label: "Roster partial", helper: `${actual}/${expected} participants` };
  }

  if (actual === 0 && expected <= 1) {
    return { tone: "warning", label: "Needs participant", helper: "Can use POC as participant" };
  }

  if (actual === 0) {
    return { tone: "error", label: "Roster missing", helper: `${expected || "Unknown"} expected` };
  }

  return { tone: "warning", label: formatStatusLabel(status), helper: `${actual}/${expected || actual} participants` };
}

function taskTemplateName(task: AdminRow) {
  if (task.category === "PAYMENT_FOLLOW_UP") {
    return "Payment Reminder";
  }

  if (task.category === "SUPPORTING_DOCUMENTS") {
    return "Supporting Documents Request";
  }

  return "Participant List Request";
}

function organizationProfileFromRow(organization?: AdminRow | null) {
  return {
    addressLine1: organization?.addressLine1 ?? "",
    addressLine2: organization?.addressLine2 ?? "",
    city: organization?.city ?? "",
    state: organization?.state ?? "",
    zip: organization?.zip ?? "",
    phone: organization?.phone ?? "",
    website: organization?.website ?? ""
  };
}

function organizationProfilePayload(profile: AdminRow) {
  return {
    addressLine1: String(profile.addressLine1 ?? "").trim() || undefined,
    addressLine2: String(profile.addressLine2 ?? "").trim() || undefined,
    city: String(profile.city ?? "").trim() || undefined,
    state: String(profile.state ?? "").trim().toUpperCase() || undefined,
    zip: String(profile.zip ?? "").trim() || undefined,
    phone: String(profile.phone ?? "").trim() || undefined,
    website: String(profile.website ?? "").trim() || undefined
  };
}

function organizationProfileChanged(organization: AdminRow | null, payload: AdminRow) {
  if (!organization) return false;
  return ["addressLine1", "addressLine2", "city", "state", "zip", "phone", "website"].some((key) =>
    String(organization[key] ?? "").trim() !== String(payload[key] ?? "").trim()
  );
}

function organizationAddressSummary(organization?: AdminRow | null) {
  if (!organization) return "";
  const cityStateZip = [
    organization.city,
    [organization.state, organization.zip].filter(Boolean).join(" ")
  ].filter(Boolean).join(", ");
  return [organization.addressLine1, organization.addressLine2, cityStateZip].filter(Boolean).join("\n");
}

function latestRegistrationForOrganization(registrations: AdminRow[], organizationId?: string | null) {
  if (!organizationId) return null;
  return registrations
    .filter((registration) => registration.organizationId === organizationId && !registration.archivedAt)
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())[0] ?? null;
}

function emptyRegistration() {
  return {
    primaryContactName: "",
    primaryContactEmail: "",
    primaryContactPhone: "",
    participantCount: 0,
    paymentMethod: "UNKNOWN",
    paymentStatus: "PENDING",
    participantListStatus: "NEEDED",
    supportingDocumentStatus: "NOT_READY",
    totalAmount: 0
  };
}

export function RegistrationEditor({
  open,
  editing,
  cohorts,
  organizations,
  registrations = [],
  defaultCohortId,
  lockCohort = false,
  onClose,
  onSaved
}: {
  open: boolean;
  editing: AdminRow | null;
  cohorts: AdminRow[];
  organizations: AdminRow[];
  registrations?: AdminRow[];
  defaultCohortId?: string;
  lockCohort?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<AdminRow>(emptyRegistration());
  const [cohort, setCohort] = useState<AdminRow | null>(null);
  const [organization, setOrganization] = useState<AdminRow | null>(null);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [organizationProfile, setOrganizationProfile] = useState<AdminRow>({});
  const [lastAutoTotal, setLastAutoTotal] = useState<number | null>(null);
  const [attributionOpen, setAttributionOpen] = useState(false);
  const [compedHelpOpen, setCompedHelpOpen] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const nextValues = editing ?? emptyRegistration();
      const selectedCohortId = editing?.cohortId ?? defaultCohortId;
      const selectedCohort = cohorts.find((item) => item.id === selectedCohortId) ?? editing?.cohort ?? null;
      const selectedOrganization = organizations.find((item) => item.id === editing?.organizationId) ?? editing?.organization ?? null;
      setValues(nextValues);
      setCohort(selectedCohort);
      setOrganization(selectedOrganization);
      setOrganizationSearch(selectedOrganization?.name ?? "");
      setOrganizationProfile(organizationProfileFromRow(selectedOrganization));
      setLastAutoTotal(registrationTotalForCohort(selectedCohort, nextValues.participantCount));
      setAttributionOpen(Boolean(editing?.utmSource || editing?.utmMedium || editing?.utmCampaign || editing?.utmContent || editing?.utmTerm || editing?.landingPageUrl || editing?.referrerUrl));
      setError(null);
    }
  }, [cohorts, defaultCohortId, editing, open, organizations]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  const pricePerParticipant = pricePerParticipantForCohort(cohort);
  const sessionCount = sessionCountForPricing(cohort);
  const suggestedTotal = registrationTotalForCohort(cohort, values.participantCount);
  const isCompedRegistration = values.paymentMethod === "COMPED";
  const organizationName = organizationSearch.trim();
  const hasExactOrganizationMatch = organizations.some((item) => String(item.name ?? "").trim().toLowerCase() === organizationName.toLowerCase());
  const organizationOptions = organizationName && !hasExactOrganizationMatch
    ? [{ id: "__create_organization__", name: `Create "${organizationName}"`, __createOrganization: true }, ...organizations]
    : organizations;

  function setOrganizationProfileValue(name: string, value: unknown) {
    setOrganizationProfile((current) => ({ ...current, [name]: value }));
  }

  function selectOrganization(nextOrganization: AdminRow | null) {
    setOrganization(nextOrganization);
    setOrganizationSearch(nextOrganization?.name ?? "");
    setOrganizationProfile(organizationProfileFromRow(nextOrganization));

    if (!editing && nextOrganization) {
      const latest = latestRegistrationForOrganization(registrations, nextOrganization.id);
      setValues((current) => {
        const address = organizationAddressSummary(nextOrganization);
        if (!latest) {
          return {
            ...current,
            billingAddress: current.billingAddress || address
          };
        }

        return {
          ...current,
          primaryContactName: current.primaryContactName || latest.primaryContactName || "",
          primaryContactEmail: current.primaryContactEmail || latest.primaryContactEmail || "",
          primaryContactPhone: current.primaryContactPhone || latest.primaryContactPhone || "",
          primaryContactTitle: current.primaryContactTitle || latest.primaryContactTitle || "",
          billingContactName: current.billingContactName || latest.billingContactName || latest.primaryContactName || "",
          billingContactEmail: current.billingContactEmail || latest.billingContactEmail || latest.primaryContactEmail || "",
          billingAddress: current.billingAddress || latest.billingAddress || address
        };
      });
    }
  }

  useEffect(() => {
    if (!open || !cohort || isCompedRegistration) {
      return;
    }

    const currentTotal = Number(values.totalAmount ?? 0);
    const canAutoUpdate = currentTotal === 0 || (lastAutoTotal !== null && currentTotal === lastAutoTotal);
    if (canAutoUpdate && Number.isFinite(suggestedTotal) && currentTotal !== suggestedTotal) {
      setValues((current) => ({ ...current, totalAmount: suggestedTotal }));
      setLastAutoTotal(suggestedTotal);
    }
  }, [cohort, editing, isCompedRegistration, lastAutoTotal, open, suggestedTotal, values.totalAmount]);

  function setCompedRegistration(checked: boolean) {
    if (checked) {
      setValues((current) => ({
        ...current,
        paymentMethod: "COMPED",
        paymentStatus: "PAID",
        totalAmount: 0
      }));
      setLastAutoTotal(null);
      return;
    }

    setValues((current) => ({
      ...current,
      paymentMethod: "UNKNOWN",
      paymentStatus: "PENDING",
      totalAmount: suggestedTotal
    }));
    setLastAutoTotal(suggestedTotal);
  }

  async function createOrganizationInline() {
    if (!organizationSearch.trim()) {
      setError("Organization name is required");
      return;
    }

    setCreatingOrganization(true);
    setError(null);
    try {
      const created = await adminApi<AdminRow>("/api/organizations", {
        method: "POST",
        body: {
          ...organizationProfilePayload(organizationProfile),
          name: organizationSearch.trim(),
          type: "DISTRICT"
        }
      });
      selectOrganization(created);
    } catch (organizationError) {
      setError((organizationError as Error).message);
    } finally {
      setCreatingOrganization(false);
    }
  }

  async function save() {
    if (!cohort || !organization || !values.primaryContactName || !values.primaryContactEmail) {
      setError("Cohort, organization, primary contact name, and primary contact email are required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let savedOrganization = organization;
      const organizationPayload = organizationProfilePayload(organizationProfile);
      if (organizationProfileChanged(organization, organizationPayload)) {
        savedOrganization = await adminApi<AdminRow>("/api/organizations", {
          method: "PATCH",
          body: { id: organization.id, ...organizationPayload }
        });
        setOrganization(savedOrganization);
        setOrganizationProfile(organizationProfileFromRow(savedOrganization));
      }

      await adminApi("/api/registrations", {
        method: editing ? "PATCH" : "POST",
        body: {
          ...values,
          id: editing?.id,
          cohortId: cohort.id,
          organizationId: savedOrganization?.id ?? organization.id,
          billingContactName: values.billingContactName || values.primaryContactName,
          billingContactEmail: values.billingContactEmail || values.primaryContactEmail,
          billingAddress: values.billingAddress || organizationAddressSummary(savedOrganization ?? organization),
          deferNotifications: Boolean(editing && ["PUBLISHED", "ACTIVE"].includes(String(cohort.derivedStatus ?? cohort.status)))
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{editing ? "Edit Registration" : "Add Registration"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              options={cohorts}
              value={cohort}
              disabled={lockCohort}
              onChange={(_event, value) => setCohort(value)}
              getOptionLabel={(option) => option.title ?? ""}
              renderInput={(params) => <TextField {...params} label="Cohort" required />}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              options={organizationOptions}
              value={organization}
              inputValue={organizationSearch}
              onInputChange={(_event, value) => {
                setOrganizationSearch(value);
                if (organization && value !== (organization.name ?? "")) {
                  setOrganization(null);
                  setOrganizationProfile((current) => ({ ...current, name: value }));
                }
              }}
              onChange={(_event, value) => {
                if (value?.__createOrganization) {
                  void createOrganizationInline();
                  return;
                }
                selectOrganization(value);
              }}
              getOptionLabel={(option) => option.name ?? ""}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Organization"
                  required
                  helperText={creatingOrganization ? "Creating organization..." : "Search existing organizations, or choose Create when it is not listed."}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <div className="registration-editor-subsection registration-organization-profile">
              <div className="registration-editor-subsection-heading">
                <div>
                  <Typography variant="subtitle2">Organization profile</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Selecting an existing organization fills these fields. Edits here update the organization for next time.
                  </Typography>
                </div>
                {organization ? <StatusChip value="Autofilled" /> : <StatusChip value="New organization" />}
              </div>
              <Grid container spacing={1.25}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="Address line 1" value={organizationProfile.addressLine1 ?? ""} onChange={(event) => setOrganizationProfileValue("addressLine1", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="Address line 2" value={organizationProfile.addressLine2 ?? ""} onChange={(event) => setOrganizationProfileValue("addressLine2", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <TextField fullWidth label="City" value={organizationProfile.city ?? ""} onChange={(event) => setOrganizationProfileValue("city", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, md: 1 }}>
                  <TextField fullWidth label="State" value={organizationProfile.state ?? ""} onChange={(event) => setOrganizationProfileValue("state", event.target.value.toUpperCase().slice(0, 2))} />
                </Grid>
                <Grid size={{ xs: 6, md: 1 }}>
                  <TextField fullWidth label="ZIP" value={organizationProfile.zip ?? ""} onChange={(event) => setOrganizationProfileValue("zip", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="Organization phone" value={organizationProfile.phone ?? ""} onChange={(event) => setOrganizationProfileValue("phone", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField fullWidth label="Website" value={organizationProfile.website ?? ""} onChange={(event) => setOrganizationProfileValue("website", event.target.value)} />
                </Grid>
              </Grid>
            </div>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact" value={values.primaryContactName ?? ""} onChange={(event) => setValue("primaryContactName", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact email" type="email" value={values.primaryContactEmail ?? ""} onChange={(event) => setValue("primaryContactEmail", event.target.value)} required />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact phone" value={values.primaryContactPhone ?? ""} onChange={(event) => setValue("primaryContactPhone", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth label="Primary contact title" value={values.primaryContactTitle ?? ""} onChange={(event) => setValue("primaryContactTitle", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="Billing contact name"
              value={values.billingContactName ?? ""}
              onChange={(event) => setValue("billingContactName", event.target.value)}
              placeholder={values.primaryContactName ?? ""}
              helperText="Defaults to the primary contact."
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="Billing contact email"
              type="email"
              value={values.billingContactEmail ?? ""}
              onChange={(event) => setValue("billingContactEmail", event.target.value)}
              placeholder={values.primaryContactEmail ?? ""}
              helperText="Defaults to the primary contact email."
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="Participant count" type="number" value={values.participantCount ?? 0} onChange={(event) => setValue("participantCount", Number(event.target.value))} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="Roster status" value={formatStatusLabel(values.participantListStatus ?? "NEEDED")} disabled helperText="Calculated from saved participants" />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              select
              label="Payment method"
              value={values.paymentMethod ?? "UNKNOWN"}
              onChange={(event) => {
                const nextMethod = event.target.value;
                if (nextMethod === "COMPED") {
                  setCompedRegistration(true);
                } else {
                  setValue("paymentMethod", nextMethod);
                }
              }}
            >
              {paymentMethods.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth select label="Payment status" value={values.paymentStatus ?? "PENDING"} onChange={(event) => setValue("paymentStatus", event.target.value)}>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField fullWidth label="PO number" value={values.purchaseOrderNumber ?? ""} onChange={(event) => setValue("purchaseOrderNumber", event.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Total amount"
              type="number"
              value={values.totalAmount ?? 0}
              disabled={isCompedRegistration}
              onChange={(event) => setValue("totalAmount", Number(event.target.value))}
              helperText={isCompedRegistration
                ? "Free / comped registration. No invoice or payment collection is expected."
                : pricePerParticipant > 0
                ? `${money(pricePerParticipant)} x ${Number(values.participantCount ?? 0)} participant${Number(values.participantCount ?? 0) === 1 ? "" : "s"}${Number(cohort?.pricePerParticipant ?? 0) > 0 ? "" : ` · fallback ${sessionCount || "unknown"}-session pricing`}`
                : "No cohort price is configured yet; enter the total manually."}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <div className="registration-comped-inline">
              <FormControlLabel
                control={<Switch checked={isCompedRegistration} onChange={(event) => setCompedRegistration(event.target.checked)} />}
                label="Free / comped participant"
              />
              <Tooltip title="What does this mean?">
                <IconButton type="button" size="small" aria-label="Free / comped participant help" onClick={() => setCompedHelpOpen(true)}>
                  <HelpOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <div className="registration-editor-subsection">
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }}>
                <div>
                  <Typography variant="subtitle2">Advanced fields</Typography>
                  <Typography variant="body2" color="text.secondary">Optional source attribution fields. QuickBooks links are handled through cohort projects and invoices.</Typography>
                </div>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <Button type="button" variant="outlined" size="small" endIcon={<ExpandMoreOutlined />} onClick={() => setAttributionOpen((current) => !current)}>
                    {attributionOpen ? "Hide attribution" : "Attribution"}
                  </Button>
                </Stack>
              </Stack>
              <Collapse in={attributionOpen}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="UTM source" value={values.utmSource ?? ""} onChange={(event) => setValue("utmSource", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="UTM medium" value={values.utmMedium ?? ""} onChange={(event) => setValue("utmMedium", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="UTM campaign" value={values.utmCampaign ?? ""} onChange={(event) => setValue("utmCampaign", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="UTM content" value={values.utmContent ?? ""} onChange={(event) => setValue("utmContent", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="UTM term" value={values.utmTerm ?? ""} onChange={(event) => setValue("utmTerm", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth label="Landing page URL" value={values.landingPageUrl ?? ""} onChange={(event) => setValue("landingPageUrl", event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Referrer URL" value={values.referrerUrl ?? ""} onChange={(event) => setValue("referrerUrl", event.target.value)} />
                  </Grid>
                </Grid>
              </Collapse>
            </div>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth multiline minRows={3} label="Notes" value={values.notes ?? ""} onChange={(event) => setValue("notes", event.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving" : "Save"}</Button>
      </DialogActions>
      <Dialog open={compedHelpOpen} onClose={() => setCompedHelpOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Free / comped participant</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Use this for thought-leader guests, internal tests, or invited attendees who should receive roster, calendar, and email handling without billing. Mission Control sets the amount to $0 and does not expect invoice or payment collection.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompedHelpOpen(false)}>Got it</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

function RegistrationDetailDialog({
  registration,
  open,
  onClose,
  onChanged,
  templates,
  onSuccess,
  onError
}: {
  registration: AdminRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  templates: AdminRow[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [participant, setParticipant] = useState({ firstName: "", lastName: "", email: "", title: "", phone: "" });
  const [editingParticipantId, setEditingParticipantId] = useState("");
  const [participantEdit, setParticipantEdit] = useState({ firstName: "", lastName: "", email: "", title: "", phone: "" });
  const [savingParticipantId, setSavingParticipantId] = useState("");
  const [thread, setThread] = useState<AdminRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingTaskId, setSendingTaskId] = useState("");
  const [completingTaskId, setCompletingTaskId] = useState("");
  const [syncingCrm, setSyncingCrm] = useState(false);

  useEffect(() => {
    if (open) {
      setParticipant({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      setEditingParticipantId("");
      setParticipantEdit({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      setError(null);
    }
  }, [open, registration?.id]);

  async function loadPocThread(email: string) {
    setThreadLoading(true);
    try {
      setThread(await adminApi<AdminRow[]>(`/api/communications/thread?email=${encodeURIComponent(email)}`));
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setThreadLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !registration?.primaryContactEmail) {
      setThread([]);
      return;
    }

    void loadPocThread(registration.primaryContactEmail);
  }, [open, registration?.primaryContactEmail]);

  async function addParticipant() {
    if (!registration || !participant.firstName || !participant.lastName || !participant.email) {
      setError("Participant first name, last name, and email are required");
      return;
    }

    try {
      await adminApi("/api/participants", {
        method: "POST",
        body: {
          ...participant,
          registrationId: registration.id,
          cohortId: registration.cohortId,
          organizationId: registration.organizationId,
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration.cohort?.derivedStatus ?? registration.cohort?.status))
        }
      });
      setParticipant({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      await onChanged();
    } catch (addError) {
      setError((addError as Error).message);
    }
  }

  async function importRoster(participants: ParsedRosterParticipant[]) {
    if (!registration) {
      return;
    }

    try {
      for (const row of participants) {
        await adminApi("/api/participants", {
          method: "POST",
          body: {
            ...row,
            registrationId: registration.id,
            cohortId: registration.cohortId,
            organizationId: registration.organizationId,
            deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration.cohort?.derivedStatus ?? registration.cohort?.status))
          }
        });
      }

      const projectedCount = (registration.participants?.length ?? 0) + participants.length;
      if (projectedCount > Number(registration.participantCount ?? 0)) {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            id: registration.id,
            participantCount: projectedCount,
            deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration.cohort?.derivedStatus ?? registration.cohort?.status))
          }
        });
      }

      onSuccess(`${participants.length} participant${participants.length === 1 ? "" : "s"} imported.`);
      await onChanged();
    } catch (importError) {
      const message = (importError as Error).message;
      setError(message);
      onError(message);
    }
  }

  async function removeParticipant(id: string) {
    try {
      const defer = ["PUBLISHED", "ACTIVE"].includes(String(registration?.cohort?.derivedStatus ?? registration?.cohort?.status));
      await adminApi(`/api/participants?id=${id}${defer ? "&deferNotifications=1" : ""}`, { method: "DELETE" });
      await onChanged();
    } catch (removeError) {
      setError((removeError as Error).message);
    }
  }

  function startParticipantEdit(row: AdminRow) {
    setEditingParticipantId(row.id);
    setParticipantEdit({
      firstName: String(row.firstName ?? ""),
      lastName: String(row.lastName ?? ""),
      email: String(row.email ?? ""),
      title: String(row.title ?? ""),
      phone: String(row.phone ?? "")
    });
    setError(null);
  }

  async function saveParticipantEdit(row: AdminRow) {
    if (!participantEdit.firstName.trim() || !participantEdit.lastName.trim() || !participantEdit.email.trim()) {
      setError("Participant first name, last name, and email are required.");
      return;
    }

    setSavingParticipantId(row.id);
    setError(null);

    try {
      await adminApi("/api/participants", {
        method: "PATCH",
        body: {
          id: row.id,
          firstName: participantEdit.firstName.trim(),
          lastName: participantEdit.lastName.trim(),
          email: participantEdit.email.trim(),
          title: participantEdit.title.trim(),
          phone: participantEdit.phone.trim(),
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration?.cohort?.derivedStatus ?? registration?.cohort?.status))
        }
      });
      setEditingParticipantId("");
      setParticipantEdit({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      onSuccess("Participant updated.");
      await onChanged();
    } catch (saveError) {
      const message = (saveError as Error).message;
      setError(message);
      onError(message);
    } finally {
      setSavingParticipantId("");
    }
  }

  async function syncQuickBooks() {
    if (!registration?.quickBooksInvoiceRef) {
      setError("QuickBooks invoice reference is required");
      return;
    }

    try {
      await adminApi("/api/jobs/sync-quickbooks", {
        method: "POST",
        body: { invoiceId: registration.quickBooksInvoiceRef, realmId: registration.quickBooksRealmId }
      });
      await onChanged();
    } catch (syncError) {
      setError((syncError as Error).message);
    }
  }

  async function voidQuickBooksInvoice() {
    if (!registration) {
      return;
    }

    try {
      await adminApi("/api/integrations/quickbooks/void-invoice", {
        method: "POST",
        body: { registrationId: registration.id }
      });
      await onChanged();
    } catch (voidError) {
      setError((voidError as Error).message);
    }
  }

  async function syncCrm() {
    if (!registration?.id) {
      return;
    }

    setSyncingCrm(true);
    setError(null);
    try {
      await adminApi("/api/registrations", {
        method: "PATCH",
        body: { id: registration.id, action: "syncCrm" }
      });
      onSuccess("Registration synced to CRM.");
      await onChanged();
    } catch (syncError) {
      const message = (syncError as Error).message;
      setError(message);
      onError(message);
    } finally {
      setSyncingCrm(false);
    }
  }

  function revisionSummary(event: AdminRow) {
    const summary = event.normalizedSummary && typeof event.normalizedSummary === "object" ? event.normalizedSummary : {};
    const amount = Number(summary.totalAmount ?? 0);
    const participantText = `${summary.parsedParticipantCount ?? 0}${summary.participantCount ? ` / ${summary.participantCount}` : ""} participants`;
    const paymentText = [formatStatusLabel(String(summary.paymentStatus ?? "")), amount ? money(amount) : ""].filter(Boolean).join(" · ");
    return [participantText, paymentText].filter(Boolean).join(" · ");
  }

  const health = registration ? rosterHealth(registration) : null;
  const participantTotal = registration?.participants?.length ?? 0;

  async function addPocAsParticipant() {
    if (!registration?.primaryContactEmail) {
      setError("POC email is required");
      return;
    }

    const name = splitName(registration.primaryContactName);
    try {
      await adminApi("/api/participants", {
        method: "POST",
        body: {
          firstName: name.firstName || "Participant",
          lastName: name.lastName || "Participant",
          email: registration.primaryContactEmail,
          phone: registration.primaryContactPhone ?? "",
          registrationId: registration.id,
          cohortId: registration.cohortId,
          organizationId: registration.organizationId,
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration.cohort?.derivedStatus ?? registration.cohort?.status))
        }
      });
      await adminApi("/api/registrations", {
        method: "PATCH",
        body: {
          id: registration.id,
          participantCount: Math.max(1, Number(registration.participantCount ?? 0)),
          participantListStatus: registration.participantListStatus,
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(registration.cohort?.derivedStatus ?? registration.cohort?.status))
        }
      });
      await onChanged();
    } catch (addError) {
      setError((addError as Error).message);
    }
  }

  async function sendFollowUp(task: AdminRow) {
    if (!registration?.id) {
      setError("Registration is required before sending a follow-up.");
      return;
    }

    const templateName = taskTemplateName(task);
    const template = templates.find((item) => item.active && item.name === templateName) ?? templates.find((item) => item.active && item.type === "FOLLOW_UP");

    if (!template?.id) {
      setError("No active pre-made template is available for this follow-up.");
      return;
    }

    setSendingTaskId(task.id);
    setError(null);

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToRegistrations", templateId: template.id, registrationIds: [registration.id] }
      });
      onSuccess(`Sent ${template.name} to ${formatProperDisplay(registration.primaryContactName ?? "the POC")}.`);
      await onChanged();
    } catch (sendError) {
      const message = (sendError as Error).message;
      setError(message);
      onError(message);
    } finally {
      setSendingTaskId("");
    }
  }

  async function completeFollowUp(task: AdminRow) {
    setCompletingTaskId(task.id);
    setError(null);

    try {
      await adminApi("/api/operations/tasks", { method: "PATCH", body: { id: task.id, action: "complete" } });
      onSuccess("Follow-up marked complete.");
      await onChanged();
    } catch (completeError) {
      const message = (completeError as Error).message;
      setError(message);
      onError(message);
    } finally {
      setCompletingTaskId("");
    }
  }

  return (
    <QuickViewDrawer
      open={open}
      onClose={onClose}
      title={registration ? formatProperDisplay(registration.primaryContactName) || "Registration detail" : "Registration detail"}
      className="registration-detail-drawer"
      actions={
        registration ? (
          <>
            <Button variant="outlined" onClick={syncCrm} disabled={syncingCrm}>{syncingCrm ? "Syncing CRM" : "Sync to CRM"}</Button>
            <Button variant="outlined" onClick={syncQuickBooks}>Sync QuickBooks</Button>
            <Button variant="outlined" color="warning" onClick={voidQuickBooksInvoice}>Void QB Invoice</Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : null
      }
    >
      {registration ? (
        <div className="registration-detail">
          {error && <Alert severity="error">{error}</Alert>}
          <section className="registration-hero">
            <div>
              <span className="registration-kicker">{registration.organization?.name ? formatProperDisplay(registration.organization.name) : "Registration"}</span>
              <h3>{formatProperDisplay(registration.primaryContactName)}</h3>
              <p title={registration.cohort?.title ?? ""}>{registration.cohort?.title ?? "No cohort assigned"}</p>
            </div>
            <div className="registration-hero-status">
              <StatusChip value={formatRegistrationPaymentStatus(registration)} />
              <StatusChip value={health?.label} />
            </div>
          </section>

          <RegistrationPendingChangesPanel
            registration={registration}
            onApplied={async (message) => {
              onSuccess(message);
              await onChanged();
            }}
            onError={(message) => {
              setError(message);
              onError(message);
            }}
          />

          <RegistrationDeliveryPreflight registration={registration} onAddPrimaryContact={addPocAsParticipant} />

          <div className="quick-view-grid">
            <DetailTile label="POC email" value={registration.primaryContactEmail} />
            <DetailTile label="POC phone" value={registration.primaryContactPhone ?? "-"} />
            <DetailTile label="Payment" value={`${formatRegistrationPaymentStatus(registration)} · ${money(registration.totalAmount)}`} />
            <DetailTile label="Roster" value={health?.helper ?? "-"} tone={health?.tone} />
            <DetailTile label="Invoice" value={registration.invoiceNumber ?? "No invoice"} />
            <DetailTile label="PO" value={registration.purchaseOrderNumber ?? "No PO"} />
            <DetailTile label="Source" value={formatRegistrationSource(registration)} />
            <DetailTile label="Landing page" value={registration.landingPageUrl ?? "-"} />
          </div>

          {registration.quickBooksSyncError && <Alert severity="error">{registration.quickBooksSyncError}</Alert>}

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Open Follow-Ups</h3>
                <p>Operational tasks created from intake, roster, payment, and document readiness.</p>
              </div>
            </div>
            {(registration.operationsTasks ?? []).filter((task: AdminRow) => task.status !== "COMPLETED").length > 0 ? (
              <div className="quick-view-list">
                {(registration.operationsTasks ?? [])
                  .filter((task: AdminRow) => task.status !== "COMPLETED")
                  .map((task: AdminRow) => (
                    <div className="quick-view-list-row" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <span>
                          {[formatStatusLabel(task.category), task.description, task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-US") : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                        <StatusChip value={task.priority ?? task.status} />
                        <Button size="small" variant="outlined" onClick={() => sendFollowUp(task)} disabled={Boolean(sendingTaskId || completingTaskId)}>
                          {sendingTaskId === task.id ? "Sending" : "Send POC"}
                        </Button>
                        <Button size="small" variant="text" onClick={() => completeFollowUp(task)} disabled={Boolean(sendingTaskId || completingTaskId)}>
                          {completingTaskId === task.id ? "Saving" : "Complete"}
                        </Button>
                      </Stack>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState title="No open follow-ups" description="Roster, payment, and document follow-ups attached to this registration will appear here." />
            )}
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Registration Communication Journey</h3>
                <p>POC and participant confirmations, upcoming milestones, and skipped messages.</p>
              </div>
            </div>
            <RegistrationCommunicationJourney communications={registration.communications} pocEmail={registration.primaryContactEmail} onChanged={onChanged} />
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Team Roster</h3>
                <p>{health?.label} · {health?.helper}</p>
              </div>
            </div>
            {(registration.participants ?? []).length > 0 ? (
              <div className="quick-view-list">
                {(registration.participants ?? []).map((row: AdminRow) => {
                  const editing = editingParticipantId === row.id;

                  return (
                    <div className={`quick-view-list-row ${editing ? "is-editing-participant" : ""}`} key={row.id}>
                      {editing ? (
                        <div className="participant-inline-editor">
                          <TextField label="First name" value={participantEdit.firstName} onChange={(event) => setParticipantEdit((current) => ({ ...current, firstName: event.target.value }))} />
                          <TextField label="Last name" value={participantEdit.lastName} onChange={(event) => setParticipantEdit((current) => ({ ...current, lastName: event.target.value }))} />
                          <TextField label="Email" type="email" value={participantEdit.email} onChange={(event) => setParticipantEdit((current) => ({ ...current, email: event.target.value }))} />
                          <TextField label="Title" value={participantEdit.title} onChange={(event) => setParticipantEdit((current) => ({ ...current, title: event.target.value }))} />
                          <TextField label="Phone" value={participantEdit.phone} onChange={(event) => setParticipantEdit((current) => ({ ...current, phone: event.target.value }))} />
                        </div>
                      ) : (
                        <div>
                          <strong>{formatProperDisplay(`${row.firstName} ${row.lastName}`)}</strong>
                          <span>{[row.email, row.title].filter(Boolean).join(" · ") || "No contact details"}</span>
                        </div>
                      )}
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                        {editing ? (
                          <>
                            <Button size="small" variant="outlined" disabled={savingParticipantId === row.id} onClick={() => saveParticipantEdit(row)}>
                              {savingParticipantId === row.id ? "Saving" : "Save"}
                            </Button>
                            <Button size="small" variant="text" disabled={savingParticipantId === row.id} onClick={() => setEditingParticipantId("")}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={() => startParticipantEdit(row)}>Edit</Button>
                            <Button size="small" variant="text" color="error" startIcon={<DeleteOutline />} onClick={() => removeParticipant(row.id)}>Remove</Button>
                          </>
                        )}
                      </Stack>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No participant details yet" description="For one-person registrations, use the POC as the participant. For teams, add roster names when they arrive." />
            )}
            <div className="registration-add-participant">
              <TextField label="First name" value={participant.firstName} onChange={(event) => setParticipant((current) => ({ ...current, firstName: event.target.value }))} />
              <TextField label="Last name" value={participant.lastName} onChange={(event) => setParticipant((current) => ({ ...current, lastName: event.target.value }))} />
              <TextField label="Email" type="email" value={participant.email} onChange={(event) => setParticipant((current) => ({ ...current, email: event.target.value }))} />
              <TextField label="Title" value={participant.title} onChange={(event) => setParticipant((current) => ({ ...current, title: event.target.value }))} />
              <Button startIcon={<AddIcon />} onClick={addParticipant}>Add</Button>
            </div>
            <RosterWorkbench
              registration={registration}
              existingParticipants={registration.participants ?? []}
              onImport={importRoster}
              onAddPrimaryContact={addPocAsParticipant}
            />
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>POC Email Summary</h3>
                <p>High-level delivery status for this contact. Full provider history lives in Communications.</p>
              </div>
              {registration.primaryContactEmail ? (
                <Button href={`/communications?search=${encodeURIComponent(registration.primaryContactEmail)}`} variant="outlined" size="small">
                  Open in Communications
                </Button>
              ) : null}
            </div>
            <PocCommunicationHistory
              loading={threadLoading}
              communications={thread}
              pocEmail={registration.primaryContactEmail}
            />
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Jotform Revision Timeline</h3>
                <p>Imports and resubmissions linked to this registration.</p>
              </div>
            </div>
            {(registration.webhookEvents ?? []).length > 0 ? (
              <div className="quick-view-list">
                {(registration.webhookEvents ?? []).map((event: AdminRow) => (
                  <div className="quick-view-list-row" key={event.id}>
                    <div>
                      <strong>{`Revision ${event.revisionNumber ?? "-"} · ${formatStatusLabel(event.status)}`}</strong>
                      <span>{`${event.processedAt || event.createdAt ? new Date(event.processedAt ?? event.createdAt).toLocaleString("en-US") : ""}${revisionSummary(event) ? ` · ${revisionSummary(event)}` : ""}${event.errorMessage ? ` · ${event.errorMessage}` : ""}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No Jotform revisions yet" description="Jotform imports and resubmissions linked to this registration will appear here." />
            )}
          </section>

          <section className="registration-detail-section">
            <div className="registration-section-heading">
              <div>
                <h3>Finance And Source Context</h3>
                <p>Invoice, QuickBooks, and attribution details.</p>
              </div>
            </div>
            <div className="quick-view-grid">
              <DetailTile label="QB invoice" value={registration.quickBooksInvoiceRef ?? "-"} />
              <DetailTile label="QB status" value={formatStatusLabel(registration.quickBooksInvoiceStatus ?? "UNKNOWN")} />
              <DetailTile label="QB sync" value={formatStatusLabel(registration.quickBooksSyncStatus ?? "NOT SYNCED")} />
              <DetailTile label="UTM source" value={registration.utmSource ?? "-"} />
              <DetailTile label="UTM medium" value={registration.utmMedium ?? "-"} />
              <DetailTile label="UTM campaign" value={registration.utmCampaign ?? "-"} />
              <DetailTile label="Referrer" value={registration.referrerUrl ?? "-"} />
            </div>
          </section>
        </div>
      ) : (
        <Typography color="text.secondary">Loading registration detail.</Typography>
      )}
    </QuickViewDrawer>
  );
}

function DetailTile({ label, value, tone }: { label: string; value?: unknown; tone?: string }) {
  return (
    <div className={`registration-detail-tile${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong title={String(value ?? "-")}>{value == null || value === "" ? "-" : String(value)}</strong>
    </div>
  );
}

export function RegistrationRemovalDialog({
  open,
  action,
  registration,
  templates,
  onClose,
  onRemoved,
  onSuccess,
  onError
}: {
  open: boolean;
  action: "archive" | "delete" | "restore" | null;
  registration: AdminRow | null;
  templates: AdminRow[];
  onClose: () => void;
  onRemoved: () => Promise<void>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const activeTemplates = templates.filter((template) => template.active);
  const defaultTemplate = activeTemplates.find((template) => template.name === "Registration Cancellation") ?? activeTemplates.find((template) => template.type === "CUSTOM") ?? activeTemplates[0];
  const [notify, setNotify] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNotify(false);
      setTemplateId(String(defaultTemplate?.id ?? ""));
      setBusy(false);
    }
  }, [defaultTemplate?.id, open]);

  async function runAction() {
    if (!action || !registration?.id) {
      return;
    }

    setBusy(true);
    try {
      if (notify && action !== "restore") {
        if (!templateId) {
          throw new Error("Choose a notification template or turn notification off.");
        }

        await adminApi("/api/communications", {
          method: "PATCH",
          body: { action: "sendTemplateToRegistrations", templateId, registrationIds: [registration.id] }
        });
      }

      if (action === "delete") {
        await adminApi(`/api/registrations?id=${encodeURIComponent(String(registration.id))}`, { method: "DELETE" });
        onSuccess(notify ? "Notification sent and registration permanently deleted" : "Registration permanently deleted");
      } else {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            id: registration.id,
            action,
            ...(action === "archive" ? { reason: notify ? "Removed from cohort after notification" : "Removed from cohort without notification" } : {})
          }
        });
        onSuccess(action === "restore" ? "Registration restored" : notify ? "Notification sent and registration removed" : "Registration removed");
      }

      await onRemoved();
      onClose();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = action === "delete" ? "Delete registration permanently?" : action === "restore" ? "Restore registration?" : "Remove registration from cohort?";
  const buttonLabel = busy
    ? "Working..."
    : action === "delete"
      ? "Delete permanently"
      : action === "restore"
        ? "Restore"
        : "Remove registration";

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography>
            {registration
              ? `${formatProperDisplay(String(registration.primaryContactName ?? ""))} · ${registration.primaryContactEmail ?? ""}`
              : ""}
          </Typography>
          {action === "delete" ? (
            <Alert severity="warning">
              Permanent delete removes the registration, participants, payments, and registration tasks. Records with invoices or QuickBooks references are blocked and should be removed with Archive instead.
            </Alert>
          ) : action === "archive" ? (
            <Alert severity="info">
              Remove archives the registration from active cohort work without deleting history, finance context, or audit trails.
            </Alert>
          ) : (
            <Alert severity="info">Restore brings this registration back into normal operational lists.</Alert>
          )}
          {action && action !== "restore" ? (
            <>
              <FormControlLabel
                control={<Switch checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
                label="Notify the POC before removing"
              />
              {notify ? (
                <TextField select fullWidth label="Notification template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                  {activeTemplates.map((template) => (
                    <MenuItem value={template.id} key={template.id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button color={action === "delete" ? "error" : "primary"} onClick={runAction} disabled={busy}>
          {buttonLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RegistrationsClient() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [organizations, setOrganizations] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPaymentStatus, setBulkPaymentStatus] = useState("");
  const [bulkTemplateId, setBulkTemplateId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [detail, setDetail] = useState<AdminRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [source, setSource] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [visibility, setVisibility] = useState("active");
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<{ action: "archive" | "restore" | "delete"; row: AdminRow } | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const includeArchived = visibility !== "active";
    const [registrationRows, cohortRows, organizationRows, templateRows] = await Promise.all([
      adminApi<AdminRow[]>(`/api/registrations${includeArchived ? "?includeArchived=1" : ""}`),
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/organizations"),
      adminApi<AdminRow[]>("/api/communications/templates").catch(() => [])
    ]);
    setRows(registrationRows);
    setCohorts(cohortRows);
    setOrganizations(organizationRows);
    setTemplates(templateRows);
    setLoading(false);
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(await adminApi<AdminRow>(`/api/registrations?id=${id}`));
  }

  async function reloadDetail() {
    if (detail?.id) {
      await load();
      setDetail(await adminApi<AdminRow>(`/api/registrations?id=${detail.id}`));
    }
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError, visibility]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchSearch = [
          row.primaryContactName,
          row.primaryContactEmail,
          row.primaryContactPhone,
          row.cohort?.title,
          row.cohort?.shortName,
          row.organization?.name,
          row.invoiceNumber,
          row.purchaseOrderNumber,
          row.externalSubmissionId
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchPayment = paymentStatus ? row.paymentStatus === paymentStatus : true;
        const matchRoster = rosterStatus ? rosterStatusFromCounts(row) === rosterStatus : true;
        const sourceLabel = formatRegistrationSource(row);
        const matchSource = source ? sourceLabel === source : true;
        const matchCohort = cohortId ? row.cohortId === cohortId : true;
        const matchOrganization = organizationId ? row.organizationId === organizationId : true;
        const matchVisibility = visibility === "archived"
          ? Boolean(row.archivedAt)
          : visibility === "active"
            ? !row.archivedAt
            : true;
        return matchSearch && matchPayment && matchRoster && matchSource && matchCohort && matchOrganization && matchVisibility;
      }),
    [rows, search, paymentStatus, rosterStatus, source, cohortId, organizationId, visibility]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => formatRegistrationSource(row)).filter((value) => value && value !== "-"))) as string[],
    [rows]
  );
  const rowSelectionModel = useMemo<GridRowSelectionModel>(
    () => ({ type: "include", ids: new Set(selectedIds) }),
    [selectedIds]
  );

  async function mutate(body: AdminRow, success: string) {
    try {
      await adminApi("/api/registrations", { method: "PATCH", body });
      notifySuccess(success);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function runBulkAction(action: "confirm" | "cancel" | "archive" | "restore" | "payment" | "send") {
    if (selectedIds.length === 0) {
      return;
    }

    try {
      if (action === "send") {
        if (!bulkTemplateId) {
          notifyError("Choose an email template first");
          return;
        }

        await adminApi("/api/communications", {
          method: "PATCH",
          body: { action: "sendTemplateToRegistrations", templateId: bulkTemplateId, registrationIds: selectedIds }
        });
        notifySuccess("Selected communication sent");
      } else {
        if (action === "payment" && !bulkPaymentStatus) {
          notifyError("Choose a payment status first");
          return;
        }

        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            action: "bulk",
            ids: selectedIds,
            ...(action === "confirm" ? { bulkAction: "confirm" } : {}),
            ...(action === "cancel" ? { bulkAction: "cancel" } : {}),
            ...(action === "archive" ? { bulkAction: "archive" } : {}),
            ...(action === "restore" ? { bulkAction: "restore" } : {}),
            ...(action === "payment" && bulkPaymentStatus ? { paymentStatus: bulkPaymentStatus } : {})
          }
        });
        notifySuccess("Bulk update complete");
      }

      setSelectedIds([]);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const columns: GridColDef[] = [
    {
      field: "primaryContactName",
      headerName: "POC",
      flex: 1.2,
      minWidth: 210,
      renderCell: (params) => (
        <div className="app-table-identity">
          <span className="app-table-main" title={formatProperDisplay(params.row.primaryContactName)}>{formatProperDisplay(params.row.primaryContactName)}</span>
          <span className="app-table-sub" title={params.row.primaryContactEmail}>
            {params.row.archivedAt ? `Archived · ${params.row.primaryContactEmail}` : params.row.primaryContactEmail}
          </span>
        </div>
      )
    },
    {
      field: "context",
      headerName: "Organization / Cohort",
      flex: 1.35,
      minWidth: 250,
      renderCell: (params) => (
        <div className="app-table-context">
          <span className="app-table-main" title={formatProperDisplay(params.row.organization?.name ?? "")}>{formatProperDisplay(params.row.organization?.name ?? "") || "-"}</span>
          <span className="app-table-sub" title={params.row.cohort?.title ?? ""}>{params.row.cohort?.title ?? "No cohort"}</span>
        </div>
      )
    },
    {
      field: "roster",
      headerName: "Roster",
      width: 168,
      renderCell: (params) => {
        const health = rosterHealth(params.row);
        return (
          <div className="registration-roster-cell" title={`${health.label} · ${health.helper}`}>
            <span className={`registration-health-dot is-${health.tone}`} />
            <div>
              <strong>{health.label}</strong>
              <span>{health.helper}</span>
            </div>
          </div>
        );
      }
    },
    {
      field: "payment",
      headerName: "Payment",
      width: 152,
      renderCell: (params) => (
        <div className="app-table-status-stack">
          <StatusChip value={formatRegistrationPaymentStatus(params.row)} />
          <span className="app-table-sub" title={money(params.row.totalAmount)}>{money(params.row.totalAmount)}</span>
        </div>
      )
    },
    {
      field: "source",
      headerName: "Source",
      width: 154,
      renderCell: (params) => <SourcePill row={params.row} />
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit registration", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditing(params.row); setDialogOpen(true); } },
              { label: "Confirm registration", icon: <CheckCircleOutline fontSize="small" />, color: "success", onClick: () => mutate({ id: params.row.id, action: "confirm" }, "Registration confirmed") },
              { label: "Cancel registration", icon: <CancelOutlined fontSize="small" />, color: "warning", onClick: () => mutate({ id: params.row.id, action: "cancel" }, "Registration cancelled") },
              params.row.archivedAt
                ? { label: "Restore registration", icon: <ArchiveOutlined fontSize="small" />, onClick: () => setPendingLifecycleAction({ action: "restore", row: params.row }) }
                : { label: "Archive registration", icon: <ArchiveOutlined fontSize="small" />, onClick: () => setPendingLifecycleAction({ action: "archive", row: params.row }) },
              { label: "Delete permanently", icon: <DeleteOutline fontSize="small" />, color: "error", onClick: () => setPendingLifecycleAction({ action: "delete", row: params.row }) }
            ]}
          />
        </Box>
      )
    }
  ];

  return (
    <PageStack>
      <PageHeader
        title="Registrations"
        description="The POC-first operations hub for team registrations, payment status, supporting documents, and participant rosters."
        action={<ToolbarButton onClick={() => setDialogOpen(true)}>Add Registration</ToolbarButton>}
      />
      <CompactFilterBar
        resultCount={filteredRows.length}
        advanced={(
          <>
            <TextField select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <MenuItem value="">All organizations</MenuItem>
              {organizations.map((organization) => <MenuItem value={organization.id} key={organization.id}>{formatProperDisplay(organization.name)}</MenuItem>)}
            </TextField>
            <TextField select label="Source" value={source} onChange={(event) => setSource(event.target.value)}>
              <MenuItem value="">All sources</MenuItem>
              {sourceOptions.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
            </TextField>
            <TextField select label="Visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              {visibilityOptions.map((option) => <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>)}
            </TextField>
          </>
        )}
      >
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <TextField select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All payment statuses</MenuItem>
          {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Roster" value={rosterStatus} onChange={(event) => setRosterStatus(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All rosters</MenuItem>
          {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
        </TextField>
        <TextField select label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All cohorts</MenuItem>
          {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
        </TextField>
      </CompactFilterBar>
      <SectionCard title="Registration Management">
        {selectedIds.length > 0 && (
          <Stack direction={{ xs: "column", lg: "row" }} flexWrap="wrap" useFlexGap gap={1.5} alignItems={{ xs: "stretch", lg: "center" }} sx={{ mb: 2 }}>
            <StatusChip value={`${selectedIds.length} selected`} />
            <Button size="small" variant="outlined" color="success" onClick={() => runBulkAction("confirm")}>Confirm</Button>
            <Button size="small" variant="outlined" color="warning" onClick={() => runBulkAction("cancel")}>Cancel</Button>
            <Button size="small" variant="outlined" onClick={() => runBulkAction(visibility === "archived" ? "restore" : "archive")}>
              {visibility === "archived" ? "Restore" : "Archive"}
            </Button>
            <TextField select size="small" label="Payment" value={bulkPaymentStatus} onChange={(event) => setBulkPaymentStatus(event.target.value)} sx={{ minWidth: 170 }}>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("payment")}>Apply Payment</Button>
            <TextField select size="small" label="Template" value={bulkTemplateId} onChange={(event) => setBulkTemplateId(event.target.value)} sx={{ minWidth: 220 }}>
              {templates.filter((template) => template.active).map((template) => <MenuItem value={template.id} key={template.id}>{template.name}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" onClick={() => runBulkAction("send")}>Send/Resend</Button>
          </Stack>
        )}
        <TableShell>
          <AppDataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            checkboxSelection
            rowHeight={64}
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            disableRowSelectionOnClick
            rowSelectionModel={rowSelectionModel}
            onRowSelectionModelChange={(model) => setSelectedIds(Array.from(model.ids).map(String))}
            onRowClick={(params: GridRowParams) => openDetail(String(params.id))}
          />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No registrations found" description="Create a registration or adjust the filters." />}
      </SectionCard>
      <RegistrationEditor
        open={dialogOpen}
        editing={editing}
        cohorts={cohorts}
        organizations={organizations}
        registrations={rows}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={async () => {
          const defer = Boolean(editing && ["PUBLISHED", "ACTIVE"].includes(String(editing.cohort?.derivedStatus ?? editing.cohort?.status)));
          notifySuccess(defer ? "Registration saved. Review and apply its delivery changes." : editing ? "Registration updated" : "Registration created");
          await load();
        }}
      />
      <RegistrationDetailDialog
        open={detailOpen}
        registration={detail}
        templates={templates}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        onChanged={reloadDetail}
        onSuccess={notifySuccess}
        onError={notifyError}
      />
      <RegistrationRemovalDialog
        open={Boolean(pendingLifecycleAction)}
        action={pendingLifecycleAction?.action ?? null}
        registration={pendingLifecycleAction?.row ?? null}
        templates={templates}
        onClose={() => setPendingLifecycleAction(null)}
        onRemoved={async () => {
          const removedId = pendingLifecycleAction?.row.id;
          setSelectedIds((current) => current.filter((id) => id !== removedId));
          if (detail?.id === removedId && pendingLifecycleAction?.action !== "restore") {
            setDetailOpen(false);
            setDetail(null);
          }
          await load();
        }}
        onSuccess={notifySuccess}
        onError={notifyError}
      />
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
