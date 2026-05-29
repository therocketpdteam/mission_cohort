"use client";

import {
  AddIcon,
  ArticleOutlined,
  CalendarMonthOutlined,
  CheckCircleOutline,
  DashboardOutlined,
  EmailOutlined,
  GroupsOutlined,
  InsightsOutlined
} from "@/components/ui/icons";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  TextField
} from "@/components/ui/primitives";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatHumanLabel, formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
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

function DashboardPanel({
  title,
  eyebrow,
  href,
  actionLabel,
  children,
  className = ""
}: {
  title: string;
  eyebrow?: string;
  href?: Route;
  actionLabel?: string;
  children: ReactNode;
  className?: string;
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
      <div className="dashboard-panel-body">{children}</div>
    </section>
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
        <div className="dashboard-hero-actions">
          {quickActions.map(([label, href]) => (
            <Button component={Link} href={href} startIcon={<AddIcon />} variant={label === "Create Cohort" ? "contained" : "outlined"} key={label}>
              {label}
            </Button>
          ))}
        </div>
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
    <DashboardPanel title="Priority Work" eyebrow="Cohort readiness" href="/cohorts" actionLabel="View cohorts" className="dashboard-panel-priority">
      <div className="dashboard-priority-list">
        {rows.map((row) => (
          <div className="dashboard-priority-row" key={row.cohort.id}>
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
    <DashboardPanel title="Upcoming Sessions" eyebrow="Agenda" href="/cohorts" actionLabel="View cohorts">
      <div className="dashboard-agenda-list">
        {sessions.slice(0, 6).map((session) => (
          <div className="dashboard-agenda-row" key={session.id}>
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
  const [loading, setLoading] = useState(true);
  const [readinessCohort, setReadinessCohort] = useState<AdminRow | null>(null);
  const [recentRegistration, setRecentRegistration] = useState<AdminRow | null>(null);
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [paymentCohortFilter, setPaymentCohortFilter] = useState("ALL");
  const { notifyError, snackbar } = useNotifier();

  useEffect(() => {
    adminApi<AdminRow>("/api/admin-dashboard")
      .then(setData)
      .catch((error) => notifyError(error.message))
      .finally(() => setLoading(false));
  }, [notifyError]);

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

  return (
    <PageStack>
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
            <TextField select label="Cohort" value={paymentCohortFilter} onChange={(event) => setPaymentCohortFilter(event.target.value)}>
              <MenuItem value="ALL">All cohorts</MenuItem>
              {paymentCohorts.map(([id, title]) => <MenuItem value={String(id)} key={String(id)}>{String(title)}</MenuItem>)}
            </TextField>
            <TextField select label="Status" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <MenuItem value="ALL">All statuses</MenuItem>
              {(data?.paymentStatusSnapshot ?? []).map((payment: AdminRow) => <MenuItem value={payment.status} key={payment.status}>{formatStatusLabel(payment.status)}</MenuItem>)}
            </TextField>
          </div>
          <DonutChart rows={paymentChartRows} />
        </DashboardPanel>

        <DashboardPanel title="Recent Registrations" eyebrow="New arrivals" href="/registrations" actionLabel="Open list">
          <div className="dashboard-compact-list">
            {(data?.recentRegistrations ?? []).slice(0, 5).map((registration: AdminRow) => (
              <button className="dashboard-compact-row is-clickable" type="button" key={registration.id} onClick={() => openRecentRegistration(registration.id)}>
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

        <DashboardPanel title="Cohorts Needing Attention" eyebrow="Pipeline" href="/cohorts" actionLabel="View cohorts">
          <div className="dashboard-compact-list">
            {(data?.cohortsNeedingAttention ?? []).slice(0, 5).map((cohort: AdminRow) => (
              <div className="dashboard-compact-row" key={cohort.id}>
                <div className="dashboard-row-main">
                  <strong title={cohort.title}>{cohort.title}</strong>
                  <span>{formatProperDisplay(`${cohort.presenter?.firstName ?? ""} ${cohort.presenter?.lastName ?? ""}`) || "No presenter"} · {cohort._count?.registrations ?? 0} registrations</span>
                </div>
                <StatusChip value={cohort.status} />
              </div>
            ))}
          </div>
          {!loading && (data?.cohortsNeedingAttention ?? []).length === 0 && <EmptyState title="No cohorts need attention" description="Draft and registration-stage cohorts will appear here." />}
        </DashboardPanel>

        <DashboardPanel title="Recent Activity" eyebrow="Audit trail" href="/settings" actionLabel="View settings">
          <div className="dashboard-compact-list">
            {(data?.recentActivity ?? []).slice(0, 5).map((activity: AdminRow) => (
              <div className="dashboard-activity-row" key={activity.id}>
                <span className="dashboard-activity-dot" />
                <div className="dashboard-row-main">
                  <strong>{formatHumanLabel(activity.entityType)} {formatStatusLabel(activity.action)}</strong>
                  <span>{activity.description ?? "Activity"} · {new Date(activity.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
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
          <div className="dashboard-compact-list">
            {(readinessCohort?.tasks ?? []).map((task: AdminRow) => (
              <div className="dashboard-compact-row" key={task.id}>
                <div className="dashboard-row-main">
                  <strong>{task.title}</strong>
                  <span>{formatStatusLabel(task.category)} · {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</span>
                </div>
                <StatusChip value={task.status} />
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
