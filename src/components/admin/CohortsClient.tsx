"use client";

import { AddIcon, MoreHorizIcon } from "@/components/ui/icons";
import { ArchiveOutlined, CalendarMonthOutlined, GroupsOutlined, InsightsOutlined } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import { VisibilityOutlined } from "@/components/ui/icons";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Snackbar,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography
} from "@/components/ui/primitives";
import { GridColDef } from "./common";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { dateTimeInputInZoneToIso } from "@/lib/timezones";
import {
  AdminRow,
  AppDataGrid,
  EmptyState,
  FieldConfig,
  MutationDialog,
  PageStack,
  RowActionMenu,
  StatusChip,
  ToolbarButton,
  useNotifier
} from "./common";

const statusOptions = ["DRAFT", "PUBLISHED", "ACTIVE", "COMPLETED", "CANCELLED"];
const timezoneOptions = [
  { label: "EST", value: "America/New_York" },
  { label: "PST", value: "America/Los_Angeles" }
];

const editFields = (presenters: AdminRow[]): FieldConfig[] => [
  { name: "title", label: "Cohort title", required: true },
  { name: "shortName", label: "Short name" },
  { name: "slug", label: "Slug", required: true },
  { name: "thumbnailUrl", label: "Cohort thumbnail", type: "image" },
  {
    name: "presenterId",
    label: "Presenter",
    type: "select",
    options: presenters.map((presenter) => ({ label: formatProperDisplay(`${presenter.firstName} ${presenter.lastName}`), value: presenter.id })),
    required: true
  }
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function combineDateTime(date: string, time: string, timezone: string) {
  return dateTimeInputInZoneToIso(`${date}T${time || "09:00"}`, timezone);
}

function addWeeks(date: string, weeks: number) {
  if (!date) {
    return "";
  }

  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day));
  nextDate.setUTCDate(nextDate.getUTCDate() + weeks * 7);

  return nextDate.toISOString().slice(0, 10);
}

function defaultSession(index: number, timezone = "America/New_York") {
  return {
    title: `Session ${index + 1}`,
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    timezone
  };
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString("en-US") : "";
}

function cohortFinanceSummary(row: AdminRow) {
  const totalSales = (row.registrations ?? []).reduce((sum: number, registration: AdminRow) => sum + Number(registration.totalAmount ?? 0), 0);
  const paidAmount = (row.paymentRecords ?? [])
    .filter((payment: AdminRow) => payment.status === "PAID")
    .reduce((sum: number, payment: AdminRow) => sum + Number(payment.amount ?? 0), 0);
  const paidPercent = totalSales > 0 ? Math.round((paidAmount / totalSales) * 100) : 0;

  return { totalSales, paidAmount, paidPercent };
}

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function statusCount(rows: AdminRow[], value: string) {
  return rows.filter((row) => row.status === value).length;
}

function CreateCohortWizard({
  open,
  presenters,
  onClose,
  onPresenterCreated,
  onCreated
}: {
  open: boolean;
  presenters: AdminRow[];
  onClose: () => void;
  onPresenterCreated: (presenter: AdminRow) => void;
  onCreated: () => Promise<void>;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [title, setTitle] = useState("");
  const [shortName, setShortName] = useState("");
  const [slug, setSlug] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [presenter, setPresenter] = useState<AdminRow | null>(null);
  const [presenterSearch, setPresenterSearch] = useState("");
  const [showCreatePresenter, setShowCreatePresenter] = useState(false);
  const [newPresenterFirstName, setNewPresenterFirstName] = useState("");
  const [newPresenterLastName, setNewPresenterLastName] = useState("");
  const [newPresenterEmail, setNewPresenterEmail] = useState("");
  const [sessionCount, setSessionCount] = useState(1);
  const [sessions, setSessions] = useState<AdminRow[]>([defaultSession(0)]);
  const [manuallyEditedSessionIndexes, setManuallyEditedSessionIndexes] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [creatingPresenter, setCreatingPresenter] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugify(title));
    }
  }, [slugTouched, title]);

  useEffect(() => {
    if (!open) {
      setActiveStep(0);
      setTitle("");
      setShortName("");
      setSlug("");
      setThumbnailUrl("");
      setSlugTouched(false);
      setPresenter(null);
      setPresenterSearch("");
      setShowCreatePresenter(false);
      setNewPresenterFirstName("");
      setNewPresenterLastName("");
      setNewPresenterEmail("");
      setSessionCount(1);
      setSessions([defaultSession(0)]);
      setManuallyEditedSessionIndexes(new Set());
      setError(null);
    }
  }, [open]);

  function syncSessionCount(count: number) {
    const safeCount = Math.max(1, Math.min(24, count || 1));
    setSessionCount(safeCount);
    setSessions((current) => {
      const firstSession = current[0] ?? defaultSession(0);

      return Array.from({ length: safeCount }, (_item, index) => {
        const existing = current[index];

        if (existing) {
          return existing;
        }

        return {
          ...defaultSession(index, firstSession.timezone ?? "America/New_York"),
          date: firstSession.date ? addWeeks(firstSession.date, index) : "",
          startTime: firstSession.startTime ?? "09:00",
          endTime: firstSession.endTime ?? "10:00",
          timezone: firstSession.timezone ?? "America/New_York"
        };
      });
    });
    setManuallyEditedSessionIndexes((current) => new Set(Array.from(current).filter((index) => index < safeCount)));
  }

  function updateSession(index: number, field: string, value: string) {
    setSessions((current) => {
      const nextSessions = current.map((session, sessionIndex) => sessionIndex === index ? { ...session, [field]: value } : session);
      const firstSession = nextSessions[0] ?? defaultSession(0);

      if (index !== 0 || !["date", "startTime", "endTime", "timezone"].includes(field)) {
        return nextSessions;
      }

      return nextSessions.map((session, sessionIndex) => {
        if (sessionIndex === 0 || manuallyEditedSessionIndexes.has(sessionIndex)) {
          return session;
        }

        return {
          ...session,
          date: firstSession.date ? addWeeks(firstSession.date, sessionIndex) : session.date,
          startTime: firstSession.startTime,
          endTime: firstSession.endTime,
          timezone: firstSession.timezone
        };
      });
    });

    if (index > 0 && ["date", "startTime", "endTime", "timezone"].includes(field)) {
      setManuallyEditedSessionIndexes((current) => new Set(current).add(index));
    }
  }

  async function uploadThumbnail(file?: File) {
    if (!file) return;

    setThumbnailUploading(true);
    setError(null);
    try {
      const uploaded = await uploadAdminFile<{ url?: string }>(file, "cohort-thumbnail");
      if (!uploaded.url) {
        throw new Error("Thumbnail upload did not return a public URL.");
      }
      setThumbnailUrl(uploaded.url);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setThumbnailUploading(false);
    }
  }

  async function createPresenterInline() {
    const firstName = newPresenterFirstName.trim();
    const lastName = newPresenterLastName.trim();
    const email = newPresenterEmail.trim();

    if (!firstName || !lastName || !email) {
      setError("Presenter first name, last name, and email are required");
      return;
    }

    setCreatingPresenter(true);
    setError(null);
    try {
      const created = await adminApi<AdminRow>("/api/presenters", {
        method: "POST",
        body: { firstName, lastName, email, active: true }
      });
      onPresenterCreated(created);
      setPresenter(created);
      setPresenterSearch(`${created.firstName} ${created.lastName}`);
      setShowCreatePresenter(false);
      setNewPresenterFirstName("");
      setNewPresenterLastName("");
      setNewPresenterEmail("");
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreatingPresenter(false);
    }
  }

  function openCreatePresenter() {
    const [firstName = "", ...lastNameParts] = presenterSearch.trim().split(/\s+/);
    setNewPresenterFirstName((current) => current || firstName);
    setNewPresenterLastName((current) => current || lastNameParts.join(" "));
    setShowCreatePresenter(true);
  }

  function validateStep(step: number) {
    if (step === 0 && (!title || !slug || !presenter)) {
      return "Cohort title, slug, and presenter are required";
    }

    if (step === 1 && sessionCount < 1) {
      return "At least one session is required";
    }

    if (step === 2) {
      const incomplete = sessions.find((session) => !session.title || !session.date || !session.startTime || !session.endTime || !session.timezone);
      if (incomplete) {
        return "Every session needs a title, date, start time, end time, and timezone";
      }
    }

    return null;
  }

  function next() {
    const validation = validateStep(activeStep);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setActiveStep((step) => step + 1);
  }

  async function submit() {
    const validation = validateStep(2);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const firstSession = sessions[0]!;
      const lastSession = sessions[sessions.length - 1]!;
      await adminApi("/api/cohorts", {
        method: "POST",
        body: {
          title,
          shortName,
          slug,
          presenterId: presenter?.id,
          startDate: combineDateTime(firstSession.date, firstSession.startTime, firstSession.timezone),
          endDate: combineDateTime(lastSession.date, lastSession.endTime, lastSession.timezone),
          defaultTimezone: firstSession.timezone,
          pricePerParticipant: 0,
          cohortType: "LIVE_VIRTUAL",
          thumbnailUrl,
          sessions: sessions.map((session, index) => ({
            title: session.title,
            sessionNumber: index + 1,
            startTime: combineDateTime(session.date, session.startTime, session.timezone),
            endTime: combineDateTime(session.date, session.endTime, session.timezone),
            timezone: session.timezone
          }))
        }
      });
      await onCreated();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" PaperProps={{ className: "create-cohort-modal" }}>
      <DialogTitle>Create Cohort</DialogTitle>
      <DialogContent className="create-cohort-body">
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {["Basics", "Sessions", "Schedule"].map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {activeStep === 0 && (
          <Grid container spacing={2} className="create-cohort-basics-grid">
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Cohort title" value={title} onChange={(event) => setTitle(event.target.value)} required />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Short name" value={shortName} onChange={(event) => setShortName(event.target.value)} placeholder="KM Fall 2026" />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Slug"
                value={slug}
                onChange={(event) => { setSlugTouched(true); setSlug(slugify(event.target.value)); }}
                required
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <div className="image-field create-cohort-image-field">
                <div className="image-field-preview">
                  {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span>No thumbnail</span>}
                </div>
                <div className="image-field-controls">
                  <TextField fullWidth label="Cohort thumbnail URL" value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} />
                  <label className="ui-button ui-button-outlined">
                    <span>{thumbnailUploading ? "Uploading" : "Upload image"}</span>
                    <input type="file" accept="image/*" onChange={(event) => void uploadThumbnail(event.currentTarget.files?.[0])} hidden />
                  </label>
                </div>
              </div>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }} className="create-cohort-presenter-field">
              <Autocomplete
                options={presenters}
                value={presenter}
                inputValue={presenterSearch}
                onInputChange={(_event, value, reason) => {
                  if (reason === "input" || reason === "clear") {
                    setPresenterSearch(value);
                  }
                }}
                onChange={(_event, value) => {
                  setPresenter(value);
                  if (value) {
                    setShowCreatePresenter(false);
                    setPresenterSearch(`${value.firstName ?? ""} ${value.lastName ?? ""}`.trim());
                  }
                }}
                getOptionLabel={(option) => `${option.firstName ?? ""} ${option.lastName ?? ""}`.trim()}
                renderInput={(params) => <TextField {...params} label="Presenter" required />}
              />
            </Grid>
            {!presenter && (
              <Grid size={{ xs: 12 }}>
                {!showCreatePresenter ? (
                  <Button startIcon={<AddIcon />} onClick={openCreatePresenter} variant="outlined">
                    Create new presenter
                  </Button>
                ) : (
                  <Stack spacing={2}>
                    <Typography variant="subtitle2">Create presenter for future cohorts</Typography>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField fullWidth label="First name" value={newPresenterFirstName} onChange={(event) => setNewPresenterFirstName(event.target.value)} required />
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField fullWidth label="Last name" value={newPresenterLastName} onChange={(event) => setNewPresenterLastName(event.target.value)} required />
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <TextField fullWidth type="email" label="Email" value={newPresenterEmail} onChange={(event) => setNewPresenterEmail(event.target.value)} required />
                      </Grid>
                    </Grid>
                    <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
                      <Button startIcon={<AddIcon />} onClick={createPresenterInline} disabled={creatingPresenter}>
                        {creatingPresenter ? "Saving presenter" : "Save Presenter"}
                      </Button>
                      <Button variant="outlined" onClick={() => setShowCreatePresenter(false)} disabled={creatingPresenter}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Grid>
            )}
          </Grid>
        )}

        {activeStep === 1 && (
          <Stack spacing={2}>
            <TextField
              label="Qty of sessions"
              type="number"
              value={sessionCount}
              onChange={(event) => syncSessionCount(Number(event.target.value))}
              inputProps={{ min: 1, max: 24 }}
              sx={{ maxWidth: 220 }}
            />
            <Typography color="text.secondary">
              The next step will generate {sessionCount} session date/time {sessionCount === 1 ? "row" : "rows"} for notifications and calendar invites.
            </Typography>
          </Stack>
        )}

        {activeStep === 2 && (
          <Stack spacing={2}>
            <Alert severity="info">
              Set the first session date, time, and timezone. Mission Control will draft the remaining sessions weekly with the same timing, and you can still fine-tune any row.
            </Alert>
            {sessions.map((session, index) => (
              <Grid container spacing={2} key={index} alignItems="center" className="create-cohort-session-row">
                <Grid size={{ xs: 12, md: 3 }} className="create-cohort-session-title">
                  <TextField fullWidth label="Session title" value={session.title} onChange={(event) => updateSession(index, "title", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }} className="create-cohort-session-date">
                  <TextField fullWidth label="Date" type="date" value={session.date} InputLabelProps={{ shrink: true }} onChange={(event) => updateSession(index, "date", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }} className="create-cohort-session-time">
                  <TextField fullWidth label="Start" type="time" value={session.startTime} InputLabelProps={{ shrink: true }} onChange={(event) => updateSession(index, "startTime", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }} className="create-cohort-session-time">
                  <TextField fullWidth label="End" type="time" value={session.endTime} InputLabelProps={{ shrink: true }} onChange={(event) => updateSession(index, "endTime", event.target.value)} />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }} className="create-cohort-session-zone">
                  <TextField fullWidth select label="Timezone" value={session.timezone} onChange={(event) => updateSession(index, "timezone", event.target.value)}>
                    {timezoneOptions.map((option) => <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>)}
                  </TextField>
                </Grid>
              </Grid>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        {activeStep > 0 && <Button variant="outlined" onClick={() => setActiveStep((step) => step - 1)}>Back</Button>}
        {activeStep < 2 ? <Button onClick={next}>Next</Button> : <Button onClick={submit} disabled={saving}>{saving ? "Creating" : "Create Cohort"}</Button>}
      </DialogActions>
    </Dialog>
  );
}

export function CohortsClient() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [presenters, setPresenters] = useState<AdminRow[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const [archiveUndo, setArchiveUndo] = useState<{ id: string; title: string; previousStatus: string } | null>(null);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohorts, presenterRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/presenters")
    ]);
    setRows(cohorts);
    setPresenters(presenterRows);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [notifyError]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesSearch = [row.title, row.shortName, row.presenter?.firstName, row.presenter?.lastName]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesStatus = status ? row.status === status : true;
        const matchesPresenter = presenterId ? row.presenterId === presenterId : true;
        return matchesSearch && matchesStatus && matchesPresenter;
      }),
    [rows, search, status, presenterId]
  );

  const filterPills = [
    { label: "All", value: "", count: rows.length },
    ...statusOptions.map((value) => ({ label: formatStatusLabel(value), value, count: statusCount(rows, value) }))
  ];

  const columns: GridColDef[] = [
    {
      field: "open",
      headerName: "",
      width: 42,
      sortable: false,
      renderCell: () => <span className="cohort-row-chevron" aria-hidden="true">›</span>
    },
    {
      field: "title",
      headerName: "Cohort",
      flex: 4.2,
      minWidth: 460,
      renderCell: (params) => (
        <div className="cohort-cell">
          {params.row.thumbnailUrl && <img className="cohort-cell-thumb" src={params.row.thumbnailUrl} alt="" />}
          <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
            <Typography className="cohort-cell-title" fontWeight={850}>{params.row.title}</Typography>
          </Stack>
        </div>
      )
    },
    {
      field: "presenter",
      headerName: "Presenter",
      flex: 0.95,
      minWidth: 144,
      valueGetter: (_value, row) => formatProperDisplay(`${row.presenter?.firstName ?? ""} ${row.presenter?.lastName ?? ""}`)
    },
    {
      field: "dates",
      headerName: "Dates",
      width: 156,
      valueGetter: (_value, row) => `${formatDate(row.startDate)} - ${formatDate(row.endDate)}`
    },
    {
      field: "counts",
      headerName: "Quick View",
      width: 248,
      renderCell: (params) => {
        const finance = cohortFinanceSummary(params.row);
        return (
        <div className="cohort-quick-view" title={`${params.row._count?.sessions ?? 0} sessions, ${params.row._count?.registrations ?? 0} registrations, ${params.row._count?.participants ?? 0} participants, ${finance.paidPercent}% paid, ${money(finance.totalSales)} total sales`}>
          <div className="cohort-counts">
            <span><CalendarMonthOutlined fontSize="small" />{params.row._count?.sessions ?? 0}</span>
            <span><InsightsOutlined fontSize="small" />{params.row._count?.registrations ?? 0}</span>
            <span><GroupsOutlined fontSize="small" />{params.row._count?.participants ?? 0}</span>
          </div>
          <div className="cohort-row-finance" style={{ "--paid": `${finance.paidPercent}%` } as CSSProperties}>
            <span>{finance.paidPercent}% paid</span>
            <strong>{money(finance.totalSales)} sales</strong>
            <i aria-hidden="true"><b /></i>
          </div>
        </div>
      );
      }
    },
    { field: "status", headerName: "Status", width: 136, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "View cohort", icon: <VisibilityOutlined fontSize="small" />, onClick: () => window.location.assign(`/cohorts/${params.row.id}`) },
              { label: "Edit cohort", icon: <EditOutlined fontSize="small" />, onClick: () => setEditing(params.row) },
              {
                label: params.row.status === "CANCELLED" ? "Restore cohort" : "Cancel cohort",
                icon: <ArchiveOutlined fontSize="small" />,
                color: "warning",
                onClick: async () => {
                  const nextStatus = params.row.status === "CANCELLED" ? "DRAFT" : "CANCELLED";
                  const previousStatus = params.row.storedStatus ?? params.row.status;

                  try {
                    await adminApi(`/api/cohorts/${params.row.id}`, { method: "PATCH", body: { status: nextStatus } });
                    if (nextStatus === "CANCELLED") {
                      setArchiveUndo({ id: params.row.id, title: params.row.title, previousStatus });
                    } else {
                      notifySuccess("Cohort restored");
                    }
                    await load();
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              }
            ]}
          />
        </Box>
      )
    }
  ];

  async function undoArchive() {
    if (!archiveUndo) {
      return;
    }

    const undo = archiveUndo;
    setArchiveUndo(null);
    try {
      await adminApi(`/api/cohorts/${undo.id}`, { method: "PATCH", body: { status: undo.previousStatus } });
      notifySuccess("Archive undone");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function saveEdit(values: AdminRow) {
    try {
      await adminApi(`/api/cohorts/${editing?.id}`, { method: "PATCH", body: values });
      notifySuccess("Cohort updated");
      setEditing(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  return (
    <PageStack className="cohort-console-page">
      <header className="cohort-console-header">
        <div>
          <h1>Cohorts</h1>
          <p>Create cohorts, sessions, presenters, and delivery timelines from one operations workspace.</p>
        </div>
        <ToolbarButton onClick={() => setWizardOpen(true)}>Create Cohort</ToolbarButton>
      </header>

      <section className="cohort-console-filters" aria-label="Cohort filters">
        <div className="cohort-console-filter-label">
          <MoreHorizIcon fontSize="small" />
          <span>Filters</span>
        </div>
        <div className="cohort-console-filter-pills">
          {filterPills.map((pill) => (
            <button
              type="button"
              className={`cohort-filter-pill ${status === pill.value ? "is-active" : ""} ${pill.value === "CANCELLED" ? "is-danger" : ""}`}
              key={pill.value || "all"}
              onClick={() => setStatus(pill.value)}
            >
              <span>{pill.label}</span>
              <strong>{pill.count}</strong>
            </button>
          ))}
        </div>
        <div className="cohort-console-more-filter">
          <TextField select label="Presenter" value={presenterId} onChange={(event) => setPresenterId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All presenters</MenuItem>
            {presenters.map((presenter) => (
              <MenuItem value={presenter.id} key={presenter.id}>
                {formatProperDisplay(`${presenter.firstName} ${presenter.lastName}`)}
              </MenuItem>
            ))}
          </TextField>
        </div>
        <TextField className="cohort-console-search" label="Search cohorts" value={search} onChange={(event) => setSearch(event.target.value)} />
      </section>

      <section className="cohort-console-table" aria-label="Cohort list">
        <AppDataGrid
          rows={filteredRows}
          columns={columns}
          loading={loading}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          onRowClick={(params) => router.push(`/cohorts/${params.id}`)}
        />
        {!loading && filteredRows.length === 0 && <EmptyState title="No cohorts found" description="Create a cohort or adjust the filters." />}
      </section>
      <CreateCohortWizard
        open={wizardOpen}
        presenters={presenters}
        onClose={() => setWizardOpen(false)}
        onPresenterCreated={(created) => {
          setPresenters((current) => current.some((presenter) => presenter.id === created.id) ? current : [...current, created]);
          notifySuccess("Presenter saved");
        }}
        onCreated={async () => {
          notifySuccess("Cohort and sessions created");
          await load();
        }}
      />
      <MutationDialog
        title="Edit Cohort"
        open={Boolean(editing)}
        fields={editFields(presenters)}
        initialValues={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSubmit={saveEdit}
      />
      <Box>{snackbar}</Box>
      <Snackbar
        open={Boolean(archiveUndo)}
        autoHideDuration={30000}
        onClose={() => setArchiveUndo(null)}
        message={archiveUndo ? `${archiveUndo.title} cancelled` : ""}
        action={<Button color="secondary" size="small" onClick={undoArchive}>Undo</Button>}
      />
    </PageStack>
  );
}
