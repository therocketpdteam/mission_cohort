"use client";

import { AddLinkOutlined, BlockOutlined } from "@/components/ui/icons";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, TextField, Typography } from "@/components/ui/primitives";
import { GridColDef } from "./common";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { AdminRow, AppDataGrid, EmptyState, PageHeader, PageStack, RowActionMenu, SectionCard, StatusChip, TableShell, useNotifier } from "./common";

const registrationStatuses = ["NEW", "CONFIRMED", "CANCELLED"];
const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];
const rosterStatuses = ["NOT_REQUESTED", "NEEDED", "PARTIAL", "COMPLETE"];
const audienceOptions = [
  { value: "thought_leader", label: "Thought leader / public-safe" },
  { value: "internal", label: "Internal operations" }
];
const visibilityOptions = [
  { value: "active", label: "Active registrations" },
  { value: "all", label: "Include archived" }
];
const defaultColumns = ["organization", "city", "state", "zip", "pocName", "participants", "amount", "paymentStatus", "rosterStatus", "createdAt"];
const columnOptions = [
  { key: "organization", label: "Organization" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "cityState", label: "City / State" },
  { key: "pocName", label: "POC name" },
  { key: "participants", label: "Participants" },
  { key: "amount", label: "Amount" },
  { key: "paymentStatus", label: "Payment status" },
  { key: "rosterStatus", label: "Roster status" },
  { key: "createdAt", label: "Registration date" },
  { key: "source", label: "Source" },
  { key: "registrationStatus", label: "Registration status" },
  { key: "pocEmail", label: "POC email", internalOnly: true },
  { key: "pocPhone", label: "POC phone", internalOnly: true },
  { key: "paymentMethod", label: "Payment method", internalOnly: true },
  { key: "invoiceRefs", label: "PO / invoice refs", internalOnly: true },
  { key: "participantNames", label: "Participant names", internalOnly: true },
  { key: "notes", label: "Notes", internalOnly: true }
];

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function shortDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function cityState(row: AdminRow) {
  return [row.city, row.state].filter(Boolean).join(", ") || "-";
}

function columnLabel(key: string) {
  return columnOptions.find((option) => option.key === key)?.label ?? key;
}

function reportCell(row: AdminRow, column: string) {
  switch (column) {
    case "organization":
      return formatProperDisplay(row.organization);
    case "city":
      return row.city || "-";
    case "state":
      return row.state || "-";
    case "zip":
      return row.zip || "-";
    case "cityState":
      return cityState(row);
    case "pocName":
      return formatProperDisplay(row.pocName);
    case "participants":
      return row.participants ?? 0;
    case "amount":
      return money(row.amount);
    case "paymentStatus":
      return formatStatusLabel(row.paymentStatus);
    case "paymentMethod":
      return formatStatusLabel(row.paymentMethod);
    case "rosterStatus":
      return formatStatusLabel(row.rosterStatus);
    case "registrationStatus":
      return formatStatusLabel(row.registrationStatus);
    case "createdAt":
      return shortDate(row.createdAt);
    case "source":
      return row.source ?? "-";
    case "pocEmail":
      return row.pocEmail ?? "-";
    case "pocPhone":
      return row.pocPhone ?? "-";
    case "invoiceRefs":
      return [row.purchaseOrderNumber ? `PO ${row.purchaseOrderNumber}` : "", row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : ""].filter(Boolean).join(" / ") || "-";
    case "participantNames":
      return Array.isArray(row.participantNames) && row.participantNames.length ? row.participantNames.join(", ") : "-";
    case "notes":
      return row.notes ?? "-";
    default:
      return "-";
  }
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="registration-report-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BreakdownList({ title, rows, valueLabel }: { title: string; rows: AdminRow[]; valueLabel: string }) {
  return (
    <div className="registration-report-breakdown">
      <h4>{title}</h4>
      <div>
        {rows.slice(0, 6).map((row) => (
          <p key={row.label}>
            <span>{row.label}</span>
            <strong>{row.registrations} {valueLabel} · {money(row.amount)}</strong>
          </p>
        ))}
        {rows.length === 0 && <p><span>No data yet</span><strong>-</strong></p>}
      </div>
    </div>
  );
}

function RegistrationReportPreview({ report, columns }: { report: AdminRow; columns: string[] }) {
  const filters = report.filters ?? {};
  const activeFilters = [
    filters.registrationStatus && `Registration: ${formatStatusLabel(filters.registrationStatus)}`,
    filters.paymentStatus && `Payment: ${formatStatusLabel(filters.paymentStatus)}`,
    filters.rosterStatus && `Roster: ${formatStatusLabel(filters.rosterStatus)}`,
    filters.cityState && `Location: ${filters.cityState}`,
    filters.source && `Source: ${filters.source}`,
    filters.dateFrom && `From ${shortDate(filters.dateFrom)}`,
    filters.dateTo && `To ${shortDate(filters.dateTo)}`,
    filters.includeArchived && "Includes archived"
  ].filter(Boolean);

  return (
    <article className="registration-report-print">
      <header className="registration-report-print-header">
        <div>
          <p>Mission Cohort Report</p>
          <h1>{report.cohort?.title ?? "Cohort Registration Report"}</h1>
          <span>Generated {shortDate(report.generatedAt)} · {report.audience === "internal" ? "Internal operations" : "Thought leader / public-safe"}</span>
        </div>
        <StatusChip value={report.cohort?.status} />
      </header>

      <section className="registration-report-filter-summary">
        <strong>Selected filters</strong>
        <span>{activeFilters.length ? activeFilters.join(" · ") : "All active registrations for this cohort"}</span>
      </section>

      <section className="registration-report-summary-grid">
        <SummaryTile label="Registrations" value={report.summary?.totalRegistrations ?? 0} />
        <SummaryTile label="Participant Seats" value={report.summary?.participantSeats ?? 0} />
        <SummaryTile label="Total Sold" value={money(report.summary?.totalSold)} />
        <SummaryTile label="Paid Amount" value={money(report.summary?.paidAmount)} />
        <SummaryTile label="Pending Amount" value={money(report.summary?.pendingAmount)} />
        <SummaryTile label="Geographic Matches" value={report.summary?.geographicMatches ?? 0} />
      </section>

      <section className="registration-report-insight">
        <h2>Outreach Timing Insight</h2>
        <p>{report.recommendedOutreachNote}</p>
        <div className="registration-report-breakdowns">
          <BreakdownList title="Registrations By Month" rows={report.monthlyBreakdown ?? []} valueLabel="registrations" />
          <BreakdownList title="Registrations By Source" rows={report.sourceBreakdown ?? []} valueLabel="registrations" />
        </div>
      </section>

      <section className="registration-report-table-wrap">
        <h2>Registration List</h2>
        <table className="registration-report-table">
          <thead>
            <tr>
              {columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}
            </tr>
          </thead>
          <tbody>
            {(report.registrations ?? []).map((row: AdminRow) => (
              <tr key={row.id}>
                {columns.map((column) => <td key={column}>{reportCell(row, column)}</td>)}
              </tr>
            ))}
            {(report.registrations ?? []).length === 0 && (
              <tr>
                <td colSpan={columns.length || 1}>No registrations match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </article>
  );
}

export function ReportsClient() {
  const [cohorts, setCohorts] = useState<AdminRow[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [audience, setAudience] = useState("thought_leader");
  const [registrationStatus, setRegistrationStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [cityStateFilter, setCityStateFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [visibility, setVisibility] = useState("active");
  const [selectedColumns, setSelectedColumns] = useState<string[]>(defaultColumns);
  const [reportData, setReportData] = useState<AdminRow | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reports, setReports] = useState<AdminRow[]>([]);
  const [links, setLinks] = useState<AdminRow[]>([]);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  const availableColumns = useMemo(() => columnOptions.filter((column) => audience === "internal" || !column.internalOnly), [audience]);
  const safeSelectedColumns = useMemo(() => selectedColumns.filter((column) => availableColumns.some((option) => option.key === column)), [availableColumns, selectedColumns]);

  async function load(cohortId = selectedCohortId) {
    const [cohortRows, reportDataRows] = await Promise.all([
      adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
      adminApi<AdminRow>(`/api/reports?includeLinks=true${cohortId ? `&cohortId=${cohortId}` : ""}`)
    ]);
    setCohorts(cohortRows);
    setReports(reportDataRows.reports ?? []);
    setLinks(reportDataRows.links ?? []);
  }

  useEffect(() => {
    load().catch((error) => notifyError(error.message));
  }, [notifyError]);

  useEffect(() => {
    if (audience !== "internal") {
      setSelectedColumns((current) => current.filter((column) => !columnOptions.find((option) => option.key === column)?.internalOnly));
    }
  }, [audience]);

  const currentReport = reports[0];
  const metrics = useMemo(() => {
    if (!currentReport) return [];

    return [
      ["Registrations", currentReport.registrationSummary?.total ?? 0],
      ["Participants", currentReport.participantSummary?.total ?? 0],
      ["Pending Amount", money(currentReport.paymentSummary?.pendingAmount)],
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

  function toggleColumn(column: string) {
    setSelectedColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  async function generateReport() {
    if (!selectedCohortId) {
      notifyError("Choose a cohort before generating a registration report.");
      return;
    }

    if (safeSelectedColumns.length === 0) {
      notifyError("Choose at least one report column.");
      return;
    }

    const params = new URLSearchParams({
      reportType: "cohort_registration",
      cohortId: selectedCohortId,
      audience,
      columns: safeSelectedColumns.join(",")
    });
    if (registrationStatus) params.set("registrationStatus", registrationStatus);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    if (rosterStatus) params.set("rosterStatus", rosterStatus);
    if (cityStateFilter) params.set("cityState", cityStateFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (sourceFilter) params.set("source", sourceFilter);
    if (visibility === "all") params.set("includeArchived", "1");

    setReportLoading(true);
    try {
      const nextReport = await adminApi<AdminRow>(`/api/reports?${params.toString()}`);
      setReportData(nextReport);
      setReportOpen(true);
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setReportLoading(false);
    }
  }

  const linkColumns: GridColDef[] = [
    {
      field: "title",
      headerName: "Share Link",
      flex: 1.4,
      minWidth: 260,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={800} noWrap>{params.row.title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{`/reports/share/${params.row.token}`}</Typography>
        </Box>
      )
    },
    { field: "cohort", headerName: "Cohort", flex: 1, minWidth: 220, valueGetter: (_value, row) => row.cohort?.title ?? "All cohorts" },
    { field: "status", headerName: "Status", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "expiresAt", headerName: "Expires", width: 132, valueFormatter: (value) => value ? new Date(value).toLocaleDateString() : "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu actions={[{ label: "Revoke link", icon: <BlockOutlined fontSize="small" />, color: "error", onClick: () => revokeLink(params.row.id) }]} />
        </Box>
      )
    }
  ];

  return (
    <PageStack className="reports-page">
      <PageHeader
        title="Reports"
        description="Build cohort registration reports, answer thought leader questions, and keep secure summary links available."
        action={<Button startIcon={<AddLinkOutlined />} onClick={createShareLink}>Create Share Link</Button>}
      />

      <SectionCard title="Cohort Registration Report Builder">
        <div className="registration-report-builder">
          <div className="registration-report-builder-grid">
            <TextField select label="Cohort" value={selectedCohortId} onChange={(event) => { setSelectedCohortId(event.target.value); load(event.target.value); }} fullWidth>
              <MenuItem value="">Choose a cohort</MenuItem>
              {cohorts.map((cohort) => <MenuItem value={cohort.id} key={cohort.id}>{cohort.title}</MenuItem>)}
            </TextField>
            <TextField select label="Audience" value={audience} onChange={(event) => setAudience(event.target.value)} fullWidth>
              {audienceOptions.map((option) => <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>)}
            </TextField>
            <TextField select label="Registration status" value={registrationStatus} onChange={(event) => setRegistrationStatus(event.target.value)} fullWidth>
              <MenuItem value="">All registration statuses</MenuItem>
              {registrationStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <TextField select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} fullWidth>
              <MenuItem value="">All payment statuses</MenuItem>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <TextField select label="Roster status" value={rosterStatus} onChange={(event) => setRosterStatus(event.target.value)} fullWidth>
              <MenuItem value="">All roster statuses</MenuItem>
              {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <TextField label="City / state" value={cityStateFilter} onChange={(event) => setCityStateFilter(event.target.value)} placeholder="Rapid City or South Dakota" fullWidth />
            <TextField label="Registered from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} fullWidth />
            <TextField label="Registered to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} fullWidth />
            <TextField label="Source / campaign" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} fullWidth />
            <TextField select label="Visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)} fullWidth>
              {visibilityOptions.map((option) => <MenuItem value={option.value} key={option.value}>{option.label}</MenuItem>)}
            </TextField>
          </div>

          <div className="registration-report-columns">
            <div>
              <h3>Report columns</h3>
              <p>{audience === "internal" ? "Internal mode unlocks operational fields." : "Public-safe mode hides emails, phone, notes, invoice refs, and participant names."}</p>
            </div>
            <div className="registration-report-column-grid">
              {availableColumns.map((column) => (
                <label className="registration-report-check" key={column.key}>
                  <input type="checkbox" checked={safeSelectedColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="registration-report-actions">
            <Button variant="outlined" onClick={() => setSelectedColumns(defaultColumns)}>Reset columns</Button>
            <Button onClick={generateReport} disabled={reportLoading || !selectedCohortId}>{reportLoading ? "Generating" : "Preview report"}</Button>
          </div>
        </div>
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
            <Stack spacing={1}>
              {Object.entries(currentReport?.paymentSummary?.byStatus ?? {}).map(([status, value]) => (
                <Stack key={status} direction="row" justifyContent="space-between" alignItems="center" sx={{ borderBottom: 1, borderColor: "divider", py: 1 }}>
                  <StatusChip value={status} />
                  <Typography fontWeight={800}>{String(value)}</Typography>
                </Stack>
              ))}
              {!currentReport && <EmptyState title="No payment data" description="Payment status data will appear after registrations are imported." />}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Secure Share Links">
            <TableShell>
              <AppDataGrid rows={links} columns={linkColumns} pageSizeOptions={[10, 25]} initialState={{ pagination: { paginationModel: { pageSize: 10 } } }} />
            </TableShell>
          </SectionCard>
        </Grid>
      </Grid>

      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle>Cohort Registration Report Preview</DialogTitle>
        <DialogContent>
          {reportData && <RegistrationReportPreview report={reportData} columns={safeSelectedColumns} />}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setReportOpen(false)}>Close</Button>
          <Button onClick={() => window.print()}>Download PDF</Button>
        </DialogActions>
      </Dialog>

      {reportData && (
        <div className="registration-report-print-root" aria-hidden="true">
          <RegistrationReportPreview report={reportData} columns={safeSelectedColumns} />
        </div>
      )}

      {snackbar}
    </PageStack>
  );
}
