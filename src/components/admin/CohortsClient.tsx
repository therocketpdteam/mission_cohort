"use client";

import AddIcon from "@mui/icons-material/Add";
import ArchiveOutlined from "@mui/icons-material/ArchiveOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
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
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
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
  ToolbarButton,
  useNotifier
} from "./common";

const statusOptions = ["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "ACTIVE"];
const timezoneOptions = [
  { label: "EST", value: "America/New_York" },
  { label: "PST", value: "America/Los_Angeles" }
];

const editFields = (presenters: AdminRow[]): FieldConfig[] => [
  { name: "title", label: "Cohort title", required: true },
  { name: "slug", label: "Slug", required: true },
  {
    name: "presenterId",
    label: "Presenter",
    type: "select",
    options: presenters.map((presenter) => ({ label: `${presenter.firstName} ${presenter.lastName}`, value: presenter.id })),
    required: true
  },
  { name: "status", label: "Status", type: "select", options: statusOptions.map((value) => ({ label: value.replace(/_/g, " "), value })) }
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function combineDateTime(date: string, time: string) {
  return `${date}T${time || "09:00"}:00`;
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
  return value ? new Date(value).toLocaleDateString() : "";
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
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState("DRAFT");
  const [presenter, setPresenter] = useState<AdminRow | null>(null);
  const [presenterSearch, setPresenterSearch] = useState("");
  const [showCreatePresenter, setShowCreatePresenter] = useState(false);
  const [newPresenterFirstName, setNewPresenterFirstName] = useState("");
  const [newPresenterLastName, setNewPresenterLastName] = useState("");
  const [newPresenterEmail, setNewPresenterEmail] = useState("");
  const [sessionCount, setSessionCount] = useState(1);
  const [sessions, setSessions] = useState<AdminRow[]>([defaultSession(0)]);
  const [saving, setSaving] = useState(false);
  const [creatingPresenter, setCreatingPresenter] = useState(false);
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
      setSlug("");
      setSlugTouched(false);
      setStatus("DRAFT");
      setPresenter(null);
      setPresenterSearch("");
      setShowCreatePresenter(false);
      setNewPresenterFirstName("");
      setNewPresenterLastName("");
      setNewPresenterEmail("");
      setSessionCount(1);
      setSessions([defaultSession(0)]);
      setError(null);
    }
  }, [open]);

  function syncSessionCount(count: number) {
    const safeCount = Math.max(1, Math.min(24, count || 1));
    setSessionCount(safeCount);
    setSessions((current) =>
      Array.from({ length: safeCount }, (_item, index) => current[index] ?? defaultSession(index, current[0]?.timezone ?? "America/New_York"))
    );
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
          slug,
          status,
          presenterId: presenter?.id,
          startDate: combineDateTime(firstSession.date, firstSession.startTime),
          endDate: combineDateTime(lastSession.date, lastSession.endTime),
          defaultTimezone: firstSession.timezone,
          pricePerParticipant: 0,
          cohortType: "LIVE_VIRTUAL",
          sessions: sessions.map((session, index) => ({
            title: session.title,
            sessionNumber: index + 1,
            startTime: combineDateTime(session.date, session.startTime),
            endTime: combineDateTime(session.date, session.endTime),
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Create Cohort</DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {["Basics", "Sessions", "Schedule"].map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {activeStep === 0 && (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Cohort title" value={title} onChange={(event) => setTitle(event.target.value)} required />
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
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField select fullWidth label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                {statusOptions.map((value) => <MenuItem value={value} key={value}>{value.replace(/_/g, " ")}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
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
                    <Stack direction="row" spacing={1}>
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
            {sessions.map((session, index) => (
              <Grid container spacing={2} key={index} alignItems="center">
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField fullWidth label="Session title" value={session.title} onChange={(event) => {
                    const nextSessions = [...sessions];
                    nextSessions[index] = { ...session, title: event.target.value };
                    setSessions(nextSessions);
                  }} />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <TextField fullWidth label="Date" type="date" value={session.date} InputLabelProps={{ shrink: true }} onChange={(event) => {
                    const nextSessions = [...sessions];
                    nextSessions[index] = { ...session, date: event.target.value };
                    setSessions(nextSessions);
                  }} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                  <TextField fullWidth label="Start" type="time" value={session.startTime} InputLabelProps={{ shrink: true }} onChange={(event) => {
                    const nextSessions = [...sessions];
                    nextSessions[index] = { ...session, startTime: event.target.value };
                    setSessions(nextSessions);
                  }} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                  <TextField fullWidth label="End" type="time" value={session.endTime} InputLabelProps={{ shrink: true }} onChange={(event) => {
                    const nextSessions = [...sessions];
                    nextSessions[index] = { ...session, endTime: event.target.value };
                    setSessions(nextSessions);
                  }} />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField fullWidth select label="Timezone" value={session.timezone} onChange={(event) => {
                    const nextSessions = [...sessions];
                    nextSessions[index] = { ...session, timezone: event.target.value };
                    setSessions(nextSessions);
                  }}>
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
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [presenters, setPresenters] = useState<AdminRow[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohorts, presenterRows, paymentRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/cohorts"),
      adminApi<AdminRow[]>("/api/presenters"),
      adminApi<AdminRow[]>("/api/payments").catch(() => [])
    ]);
    setRows(cohorts);
    setPresenters(presenterRows);
    setPayments(paymentRows);
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
        const matchesSearch = [row.title, row.presenter?.firstName, row.presenter?.lastName]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesStatus = status ? row.status === status : true;
        const matchesPresenter = presenterId ? row.presenterId === presenterId : true;
        return matchesSearch && matchesStatus && matchesPresenter;
      }),
    [rows, search, status, presenterId]
  );

  const columns: GridColDef[] = [
    { field: "title", headerName: "Cohort title", flex: 1.4, minWidth: 220 },
    {
      field: "presenter",
      headerName: "Presenter",
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row) => `${row.presenter?.firstName ?? ""} ${row.presenter?.lastName ?? ""}`
    },
    { field: "status", headerName: "Status", width: 170, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "startDate", headerName: "First session", width: 140, valueFormatter: (value) => formatDate(value) },
    { field: "endDate", headerName: "Last session", width: 140, valueFormatter: (value) => formatDate(value) },
    { field: "sessions", headerName: "Sessions", width: 110, valueGetter: (_value, row) => row._count?.sessions ?? row.sessions?.length ?? 0 },
    { field: "registrations", headerName: "Registrations", width: 130, valueGetter: (_value, row) => row._count?.registrations ?? 0 },
    { field: "participants", headerName: "Participants", width: 130, valueGetter: (_value, row) => row._count?.participants ?? 0 },
    {
      field: "pendingPayments",
      headerName: "Pending payments",
      width: 150,
      valueGetter: (_value, row) =>
        payments.filter((payment) => payment.cohortId === row.id && ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status)).length
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 260,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button component={Link} href={`/cohorts/${params.row.id}` as Route} variant="outlined" startIcon={<VisibilityOutlined />}>
            View
          </Button>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setEditing(params.row)}>
            Edit
          </Button>
          <Button
            color="warning"
            variant="outlined"
            startIcon={<ArchiveOutlined />}
            onClick={async () => {
              try {
                await adminApi(`/api/cohorts/${params.row.id}`, { method: "PATCH", body: { status: "ARCHIVED" } });
                notifySuccess("Cohort archived");
                await load();
              } catch (error) {
                notifyError((error as Error).message);
              }
            }}
          >
            Archive
          </Button>
        </Stack>
      )
    }
  ];

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
    <PageStack>
      <PageHeader
        title="Cohorts"
        description="Create cohorts, sessions, presenters, and delivery timelines from one operations workspace."
        action={<ToolbarButton onClick={() => setWizardOpen(true)}>Create Cohort</ToolbarButton>}
      />
      <SectionCard title="Filters">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All statuses</MenuItem>
            {["DRAFT", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"].map((value) => (
              <MenuItem value={value} key={value}>
                {value.replace(/_/g, " ")}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Presenter" value={presenterId} onChange={(event) => setPresenterId(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All presenters</MenuItem>
            {presenters.map((presenter) => (
              <MenuItem value={presenter.id} key={presenter.id}>
                {presenter.firstName} {presenter.lastName}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </SectionCard>
      <SectionCard title="Cohort Operations">
        <TableShell>
          <DataGrid rows={filteredRows} columns={columns} loading={loading} pageSizeOptions={[10, 25, 50]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} disableRowSelectionOnClick />
        </TableShell>
        {!loading && filteredRows.length === 0 && <EmptyState title="No cohorts found" description="Create a cohort or adjust the filters." />}
      </SectionCard>
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
    </PageStack>
  );
}
