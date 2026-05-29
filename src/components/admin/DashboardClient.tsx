"use client";

import {
  AddIcon,
  ArticleOutlined,
  CalendarMonthOutlined,
  CheckCircleOutline,
  DashboardOutlined,
  EmailOutlined,
  GroupsOutlined,
  InsightsOutlined,
  MoonOutlined,
  SendOutlined,
  SunOutlined
} from "@/components/ui/icons";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton
} from "@/components/ui/primitives";
import Link from "next/link";
import type { Route } from "next";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  DateBadge,
  DetailField,
  DonutChart,
  EmptyState,
  LoadingState,
  MetadataPill,
  PageStack,
  StatusChip,
  useNotifier
} from "./common";

type MetricConfig = {
  key: string;
  label: string;
  href: Route;
  helper: string;
  icon: ReactNode;
};

const metrics: ReadonlyArray<MetricConfig> = [
  { key: "activeCohorts", label: "Active cohorts", href: "/cohorts", helper: "Published or running now", icon: <DashboardOutlined /> },
  { key: "upcomingSessions", label: "Upcoming sessions", href: "/cohorts", helper: "Scheduled from today forward", icon: <CalendarMonthOutlined /> },
  { key: "openRegistrations", label: "Open registrations", href: "/registrations", helper: "New or confirmed records", icon: <ArticleOutlined /> },
  { key: "totalParticipants", label: "Participants", href: "/participants", helper: "Total rostered learners", icon: <GroupsOutlined /> },
  { key: "pendingPayments", label: "Payments to watch", href: "/registrations", helper: "Pending, invoiced, or partial", icon: <InsightsOutlined /> },
  { key: "scheduledCommunications", label: "Scheduled emails", href: "/communications", helper: "Queued cohort messages", icon: <EmailOutlined /> },
  { key: "openOperationsTasks", label: "Open operations", href: "/cohorts", helper: "Manual tasks needing work", icon: <CheckCircleOutline /> }
];

const quickActions: ReadonlyArray<[string, Route]> = [
  ["Create Cohort", "/cohorts"],
  ["Add Registration", "/registrations"],
  ["Create Email Template", "/communications"]
];

type DashboardDensity = "standard" | "compact";
type DashboardTheme = "normal" | "night";

type DashboardSelectOption = {
  value: string;
  label: string;
};

function cohortThumbnail(row?: AdminRow | null) {
  return row?.thumbnailUrl ?? row?.cohort?.thumbnailUrl ?? undefined;
}

function rowArtworkStyle(url?: string): CSSProperties | undefined {
  if (!url) {
    return undefined;
  }

  return {
    backgroundImage: `linear-gradient(270deg, var(--dashboard-art-fade-strong), var(--dashboard-art-fade-soft)), url(${url})`
  };
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

function shortDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function timeText(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function DashboardSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: DashboardSelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="dashboard-select" ref={ref}>
      <span className="dashboard-select-label">{label}</span>
      <button type="button" className="dashboard-select-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span>{selected?.label ?? "Select"}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="dashboard-select-menu">
          {options.map((option) => (
            <button
              type="button"
              className={`dashboard-select-option ${option.value === value ? "is-selected" : ""}`}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardPanel({
  title,
  eyebrow,
  href,
  actionLabel,
  children,
  className = "",
  scroll = false
}: {
  title: string;
  eyebrow?: string;
  href?: Route;
  actionLabel?: string;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section className={`dashboard-panel ${className}`}>
      <div className="dashboard-panel-header">
        <div>
          {eyebrow && <p className="dashboard-eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        {href && actionLabel && (
          <Button component={Link} href={href} size="small" variant="outlined">
            {actionLabel}
          </Button>
        )}
      </div>
      <div className={`dashboard-panel-body ${scroll ? "dashboard-panel-body-scroll" : ""}`}>{children}</div>
    </section>
  );
}

function DashboardToolbar({
  density,
  theme,
  onDensityChange,
  onThemeChange
}: {
  density: DashboardDensity;
  theme: DashboardTheme;
  onDensityChange: (value: DashboardDensity) => void;
  onThemeChange: (value: DashboardTheme) => void;
}) {
  return (
    <div className="dashboard-toolbar">
      <div className="dashboard-toolbar-actions">
        {quickActions.map(([label, href]) => (
          <Button component={Link} href={href} startIcon={<AddIcon />} variant={label === "Create Cohort" ? "contained" : "outlined"} key={label}>
            {label}
          </Button>
        ))}
      </div>
      <div className="dashboard-toolbar-controls">
        <div className="dashboard-segmented" aria-label="Dashboard density">
          <button type="button" className={density === "standard" ? "is-active" : ""} onClick={() => onDensityChange("standard")}>
            Standard
          </button>
          <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => onDensityChange("compact")}>
            Compact
          </button>
        </div>
        <div className="dashboard-icon-toggle" aria-label="Dashboard theme">
          <IconButton size="small" className={theme === "normal" ? "is-active" : ""} onClick={() => onThemeChange("normal")} aria-label="Normal mode">
            <SunOutlined />
          </IconButton>
          <IconButton size="small" className={theme === "night" ? "is-active" : ""} onClick={() => onThemeChange("night")} aria-label="Night mode">
            <MoonOutlined />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function DashboardHero({
  data,
  readinessCount
}: {
  data: AdminRow | null;
  readinessCount: number;
}) {
  const activeCohorts = Number(data?.metrics?.activeCohorts ?? 0);
  const upcomingSessions = Number(data?.metrics?.upcomingSessions ?? 0);
  const pendingPayments = Number(data?.metrics?.pendingPayments ?? 0);
  const openTasks = Number(data?.metrics?.openOperationsTasks ?? 0);
  const needsAttention = readinessCount > 0 || pendingPayments > 0 || openTasks > 0;

  return (
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <p className="dashboard-eyebrow">Mission Control</p>
        <h1>{needsAttention ? "Today needs a focused pass." : "Everything is tracking cleanly."}</h1>
        <p>
          {activeCohorts} active cohort{activeCohorts === 1 ? "" : "s"}, {upcomingSessions} upcoming session{upcomingSessions === 1 ? "" : "s"}, {pendingPayments} payment item{pendingPayments === 1 ? "" : "s"} to watch, and {openTasks} open operation{openTasks === 1 ? "" : "s"}.
        </p>
      </div>
      <div className="dashboard-hero-status">
        <span className={`dashboard-status-orb ${needsAttention ? "is-warning" : "is-success"}`} />
        <p className="dashboard-eyebrow">Operational state</p>
        <strong>{needsAttention ? "Needs attention" : "On track"}</strong>
        <span>{readinessCount} readiness queue{readinessCount === 1 ? "" : "s"}</span>
      </div>
    </section>
  );
}

function MetricGrid({ data }: { data: AdminRow | null }) {
  return (
    <section className="dashboard-metric-grid" aria-label="Dashboard metrics">
      {metrics.map((metric) => (
        <Link href={metric.href} className="dashboard-metric-card" key={metric.key}>
          <span className="dashboard-metric-icon">{metric.icon}</span>
          <span className="dashboard-metric-label">{metric.label}</span>
          <strong>{data?.metrics?.[metric.key] ?? "-"}</strong>
          <span className="dashboard-metric-helper">{metric.helper}</span>
        </Link>
      ))}
    </section>
  );
}

function PriorityPanel({
  loading,
  rows,
  onOpen
}: {
  loading: boolean;
  rows: AdminRow[];
  onOpen: (row: AdminRow) => void;
}) {
  return (
    <DashboardPanel title="Priority Work" eyebrow="Cohort readiness" href="/cohorts" actionLabel="View cohorts" className="dashboard-panel-priority dashboard-panel-command" scroll>
      <div className="dashboard-priority-list">
        {rows.map((row) => (
          <div className="dashboard-priority-row" key={row.cohort.id}>
            <span className="dashboard-row-art" style={rowArtworkStyle(cohortThumbnail(row.cohort))} aria-hidden="true" />
            <DateBadge value={row.nextSession?.startTime} />
            <div className="dashboard-row-main">
              <strong title={row.cohort.title}>{row.cohort.title}</strong>
              <span>
                {row.tasks.length} open task{row.tasks.length === 1 ? "" : "s"} · {row.registrationCount} registrations · {row.nextSession ? `Next ${shortDate(row.nextSession.startTime)}` : "No upcoming session"}
              </span>
            </div>
            <StatusChip value={row.tasks.length ? "Needs Attention" : "On Track"} />
            <Button size="small" variant="outlined" onClick={() => onOpen(row)}>
              Details
            </Button>
          </div>
        ))}
      </div>
      {!loading && rows.length === 0 && (
        <EmptyState title="No readiness items" description="Calendar invite tasks are handled automatically; actionable cohort work will appear here." />
      )}
    </DashboardPanel>
  );
}

function TodayPanel({ loading, sessions }: { loading: boolean; sessions: AdminRow[] }) {
  return (
    <DashboardPanel title="Upcoming Sessions" eyebrow="Agenda" href="/cohorts" actionLabel="View cohorts" className="dashboard-panel-command" scroll>
      <div className="dashboard-agenda-list">
        {sessions.slice(0, 6).map((session) => (
          <div className="dashboard-agenda-row" key={session.id}>
            <span className="dashboard-row-art" style={rowArtworkStyle(cohortThumbnail(session))} aria-hidden="true" />
            <div className="dashboard-agenda-date">
              <strong>{shortDate(session.startTime)}</strong>
              <span>{timeText(session.startTime)}</span>
            </div>
            <div className="dashboard-row-main">
              <strong title={session.title}>{session.title}</strong>
              <span>{session.cohort?.title ?? "Cohort"}</span>
            </div>
          </div>
        ))}
      </div>
      {!loading && sessions.length === 0 && <EmptyState title="No upcoming sessions" description="Upcoming cohort sessions will appear here." />}
    </DashboardPanel>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<AdminRow | null>(null);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [readinessCohort, setReadinessCohort] = useState<AdminRow | null>(null);
  const [recentRegistration, setRecentRegistration] = useState<AdminRow | null>(null);
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [paymentCohortFilter, setPaymentCohortFilter] = useState("ALL");
  const [density, setDensity] = useState<DashboardDensity>("standard");
  const [theme, setTheme] = useState<DashboardTheme>("normal");
  const [sendingTaskId, setSendingTaskId] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  useEffect(() => {
    const storedDensity = window.localStorage.getItem("mission-dashboard-density");
    const storedTheme = window.localStorage.getItem("mission-dashboard-theme");

    if (storedDensity === "compact" || storedDensity === "standard") {
      setDensity(storedDensity);
    }

    if (storedTheme === "night" || storedTheme === "normal") {
      setTheme(storedTheme);
    }

    Promise.all([
      adminApi<AdminRow>("/api/admin-dashboard"),
      adminApi<AdminRow[]>("/api/communications/templates")
    ])
      .then(([dashboardData, templateRows]) => {
        setData(dashboardData);
        setTemplates(templateRows.filter((template) => template.active !== false));
      })
      .catch((error) => notifyError(error.message))
      .finally(() => setLoading(false));
  }, [notifyError]);

  useEffect(() => {
    window.localStorage.setItem("mission-dashboard-density", density);
  }, [density]);

  useEffect(() => {
    window.localStorage.setItem("mission-dashboard-theme", theme);
  }, [theme]);

  const readinessRows = useMemo(() => {
    const taskRows = (data?.openOperationsTasks ?? []).filter((task: AdminRow) => task.category !== "CALENDAR_INVITE");
    const grouped = new Map<string, AdminRow>();

    for (const cohort of data?.cohortsNeedingAttention ?? []) {
      grouped.set(cohort.id, {
        cohort,
        tasks: [],
        nextSession: (data?.upcomingSessions ?? []).find((session: AdminRow) => session.cohortId === cohort.id),
        registrationCount: cohort._count?.registrations ?? 0,
        participantCount: cohort._count?.participants ?? 0
      });
    }

    for (const task of taskRows) {
      const cohortId = task.cohortId ?? task.cohort?.id ?? "operations";
      const current = grouped.get(cohortId) ?? {
        cohort: task.cohort ?? { id: cohortId, title: "Operations" },
        tasks: [],
        nextSession: (data?.upcomingSessions ?? []).find((session: AdminRow) => session.cohortId === cohortId),
        registrationCount: 0,
        participantCount: 0
      };
      current.tasks = [...current.tasks, task];
      grouped.set(cohortId, current);
    }

    return Array.from(grouped.values())
      .sort((a, b) => {
        const aTime = a.nextSession?.startTime ? new Date(a.nextSession.startTime).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.nextSession?.startTime ? new Date(b.nextSession.startTime).getTime() : Number.MAX_SAFE_INTEGER;

        if (aTime !== bTime) {
          return aTime - bTime;
        }

        return (b.tasks?.length ?? 0) - (a.tasks?.length ?? 0);
      })
      .slice(0, 6);
  }, [data]);

  const paymentCohorts = useMemo(
    () => Array.from(new Map((data?.paymentRecordsSnapshot ?? []).map((payment: AdminRow) => [payment.cohortId, payment.cohort?.title ?? "Cohort"])).entries()),
    [data]
  );
  const paymentCohortOptions = useMemo<DashboardSelectOption[]>(
    () => [
      { value: "ALL", label: "All cohorts" },
      ...paymentCohorts.map(([id, title]) => ({ value: String(id), label: String(title) }))
    ],
    [paymentCohorts]
  );
  const paymentStatusOptions = useMemo<DashboardSelectOption[]>(
    () => [
      { value: "ALL", label: "All statuses" },
      ...(data?.paymentStatusSnapshot ?? []).map((payment: AdminRow) => ({ value: String(payment.status), label: formatStatusLabel(payment.status) }))
    ],
    [data]
  );

  const paymentChartRows = useMemo(() => {
    const filtered = (data?.paymentRecordsSnapshot ?? []).filter((payment: AdminRow) => {
      const matchesStatus = paymentFilter === "ALL" || payment.status === paymentFilter;
      const matchesCohort = paymentCohortFilter === "ALL" || payment.cohortId === paymentCohortFilter;
      return matchesStatus && matchesCohort;
    });
    const grouped = new Map<string, AdminRow>();

    for (const payment of filtered) {
      const key = payment.status ?? "UNKNOWN";
      const current = grouped.get(key) ?? { label: formatStatusLabel(key), amount: 0, count: 0 };
      current.amount += Number(payment.amount ?? 0);
      current.count += 1;
      grouped.set(key, current);
    }

    return Array.from(grouped.values());
  }, [data, paymentCohortFilter, paymentFilter]);

  async function openRecentRegistration(id: string) {
    try {
      setRecentRegistration(await adminApi<AdminRow>(`/api/registrations?id=${id}`));
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendTaskMessage(task: AdminRow) {
    const registrationId = task.registrationId ?? task.registration?.id;

    if (!registrationId) {
      notifyError("This action item is not linked to a registration POC.");
      return;
    }

    const templateName = taskTemplateName(task);
    const template = templates.find((item) => item.name === templateName) ?? templates.find((item) => item.type === "FOLLOW_UP");

    if (!template?.id) {
      notifyError("No active pre-made template is available for this action item.");
      return;
    }

    setSendingTaskId(task.id);

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToRegistrations", templateId: template.id, registrationIds: [registrationId] }
      });
      notifySuccess(`Sent ${template.name} to ${formatProperDisplay(task.registration?.primaryContactName ?? "the POC")}.`);
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setSendingTaskId("");
    }
  }

  return (
    <PageStack className={`dashboard-page is-${density} is-${theme}`}>
      <DashboardToolbar density={density} theme={theme} onDensityChange={setDensity} onThemeChange={setTheme} />
      <DashboardHero data={data} readinessCount={readinessRows.length} />
      <MetricGrid data={data} />
      {loading && <LoadingState label="Loading dashboard" />}

      <section className="dashboard-command-grid">
        <PriorityPanel loading={loading} rows={readinessRows} onOpen={setReadinessCohort} />
        <TodayPanel loading={loading} sessions={data?.upcomingSessions ?? []} />
      </section>

      <section className="dashboard-insights-grid">
        <DashboardPanel title="Payment Snapshot" eyebrow="Revenue watch" href="/registrations" actionLabel="View registrations">
          <div className="dashboard-filter-row">
            <DashboardSelect label="Cohort" value={paymentCohortFilter} options={paymentCohortOptions} onChange={setPaymentCohortFilter} />
            <DashboardSelect label="Status" value={paymentFilter} options={paymentStatusOptions} onChange={setPaymentFilter} />
          </div>
          <DonutChart rows={paymentChartRows} />
        </DashboardPanel>

        <DashboardPanel title="Recent Registrations" eyebrow="New arrivals" href="/registrations" actionLabel="Open list" className="dashboard-panel-command" scroll>
          <div className="dashboard-compact-list">
            {(data?.recentRegistrations ?? []).slice(0, 8).map((registration: AdminRow) => (
              <button className="dashboard-compact-row is-clickable" type="button" key={registration.id} onClick={() => openRecentRegistration(registration.id)}>
                <span className="dashboard-row-art" style={rowArtworkStyle(cohortThumbnail(registration))} aria-hidden="true" />
                <div className="dashboard-row-main">
                  <strong>{formatProperDisplay(registration.primaryContactName)}</strong>
                  <span>{formatProperDisplay(registration.organization?.name ?? "Organization")} · {registration.cohort?.title ?? "Cohort"}</span>
                </div>
                <StatusChip value={registration.status} />
              </button>
            ))}
          </div>
          {!loading && (data?.recentRegistrations ?? []).length === 0 && <EmptyState title="No recent registrations" description="New registrations will appear here as they arrive." />}
        </DashboardPanel>
      </section>

      <Dialog open={Boolean(readinessCohort)} onClose={() => setReadinessCohort(null)} fullWidth maxWidth="md">
        <DialogTitle>{readinessCohort?.cohort?.title ?? "Cohort Readiness"}</DialogTitle>
        <DialogContent>
          <div className="dashboard-modal-summary">
            <MetadataPill>{readinessCohort?.registrationCount ?? 0} registrations</MetadataPill>
            <MetadataPill>{readinessCohort?.participantCount ?? 0} participants</MetadataPill>
            <MetadataPill>{readinessCohort?.nextSession ? `Next ${shortDate(readinessCohort.nextSession.startTime)}` : "No upcoming session"}</MetadataPill>
          </div>
          <Divider />
          <div className="dashboard-task-list">
            {(readinessCohort?.tasks ?? []).map((task: AdminRow) => (
              <div className="dashboard-task-row" key={task.id}>
                <div className="dashboard-row-main">
                  <strong>{task.title}</strong>
                  <span>{task.description ?? formatStatusLabel(task.category)}</span>
                  <div className="dashboard-task-meta">
                    <MetadataPill>{formatProperDisplay(task.registration?.organization?.name ?? "Organization")}</MetadataPill>
                    <MetadataPill>{formatProperDisplay(task.registration?.primaryContactName ?? "POC")}</MetadataPill>
                    <MetadataPill>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</MetadataPill>
                  </div>
                </div>
                <div className="dashboard-task-actions">
                  <StatusChip value={task.status} />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SendOutlined />}
                    disabled={!(task.registrationId ?? task.registration?.id) || Boolean(sendingTaskId)}
                    onClick={() => sendTaskMessage(task)}
                  >
                    {sendingTaskId === task.id ? "Sending" : "Send POC"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {(readinessCohort?.tasks ?? []).length === 0 && <EmptyState title="No manual readiness tasks" description="Calendar invite work is handled automatically or no action is needed right now." />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadinessCohort(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(recentRegistration)} onClose={() => setRecentRegistration(null)} fullWidth maxWidth="md">
        <DialogTitle>Registration Detail</DialogTitle>
        <DialogContent>
          {recentRegistration && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="POC" value={recentRegistration.primaryContactName} proper /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Email" value={recentRegistration.primaryContactEmail} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Organization" value={recentRegistration.organization?.name} proper /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Cohort" value={recentRegistration.cohort?.title} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Participants" value={`${recentRegistration.participants?.length ?? 0} of ${recentRegistration.participantCount ?? 0}`} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Payment" value={formatStatusLabel(recentRegistration.paymentStatus)} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Source" value={recentRegistration.utmCampaign || recentRegistration.utmSource || recentRegistration.landingPageUrl || recentRegistration.source} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><DetailField label="Amount" value={`$${Number(recentRegistration.totalAmount ?? 0).toLocaleString()}`} /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecentRegistration(null)}>Close</Button>
          {recentRegistration?.id && <Button component={Link} href="/registrations">Open registrations</Button>}
        </DialogActions>
      </Dialog>
      {snackbar}
    </PageStack>
  );
}
