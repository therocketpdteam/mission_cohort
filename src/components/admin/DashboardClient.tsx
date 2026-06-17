"use client";

import {
  ArticleOutlined,
  DashboardOutlined,
  EmailOutlined,
  GroupsOutlined,
  InsightsOutlined,
  MoreHorizIcon,
  SendOutlined
} from "@/components/ui/icons";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid
} from "@/components/ui/primitives";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import {
  AdminRow,
  DetailField,
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
  { key: "activeCohorts", label: "Active cohorts", href: "/cohorts", helper: "Published or running now", icon: <GroupsOutlined /> },
  { key: "totalParticipants", label: "Total participants", href: "/participants", helper: "Rostered participants", icon: <DashboardOutlined /> },
  { key: "revenueCollected", label: "Revenue collected", href: "/registrations", helper: "Paid payment records", icon: <InsightsOutlined /> },
  { key: "outstanding", label: "Outstanding", href: "/registrations", helper: "Pending, invoiced, or past due", icon: <ArticleOutlined /> }
];

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

function agendaDate(value?: string) {
  if (!value) {
    return { month: "-", day: "-" };
  }

  const date = new Date(value);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
    day: new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date)
  };
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function relativeTime(value?: string) {
  if (!value) {
    return "";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute));
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diff < day) {
    const hours = Math.round(diff / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(diff / day);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function timeText(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function presenterName(session: AdminRow) {
  const presenter = session.cohort?.presenter;
  return formatProperDisplay(`${presenter?.firstName ?? ""} ${presenter?.lastName ?? ""}`.trim()) || "Thought Leader";
}

function presenterInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";
}

function presenterHeadshotUrl(session: AdminRow) {
  const presenter = session.cohort?.presenter ?? {};
  return presenter.headshotUrl ||
    presenter.photoUrl ||
    presenter.avatarUrl ||
    presenter.imageUrl ||
    presenter.profileImageUrl ||
    session.cohort?.thumbnailUrl ||
    "";
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
        {!href && actionLabel && <span className="dashboard-panel-date">{actionLabel}</span>}
      </div>
      <div className={`dashboard-panel-body ${scroll ? "dashboard-panel-body-scroll" : ""}`}>{children}</div>
    </section>
  );
}

function MetricGrid({ data, finance }: { data: AdminRow | null; finance: AdminRow }) {
  const values: Record<string, string | number> = {
    activeCohorts: data?.metrics?.activeCohorts ?? "-",
    totalParticipants: data?.metrics?.totalParticipants ?? "-",
    revenueCollected: formatMoney(finance.collected),
    outstanding: formatMoney(finance.outstanding)
  };

  return (
    <section className="dashboard-metric-grid" aria-label="Dashboard metrics">
      {metrics.map((metric) => (
        <Link href={metric.href} className="dashboard-metric-card" key={metric.key}>
          <span className={`dashboard-metric-icon dashboard-metric-icon-${metric.key}`}>{metric.icon}</span>
          <span className="dashboard-metric-label">{metric.label}</span>
          <strong className={metric.key === "outstanding" ? "is-danger" : ""}>{values[metric.key]}</strong>
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
    <DashboardPanel title="Cohort Readiness" href="/cohorts" actionLabel="View cohorts" className="dashboard-panel-readiness">
      <div className="dashboard-readiness-table" role="table" aria-label="Cohort readiness">
        <div className="dashboard-readiness-head" role="row">
          <span>Cohort name</span>
          <span>Zoom ready</span>
          <span>Emails</span>
          <span>Presenter</span>
          <span>Status</span>
        </div>
        {rows.map((row) => (
          <button className="dashboard-readiness-row" type="button" key={row.cohort.id} onClick={() => onOpen(row)}>
            <div className="dashboard-row-main">
              <strong title={row.cohort.title}>{row.cohort.title}</strong>
              <span>{row.nextSession ? `Starts ${shortDate(row.nextSession.startTime)}` : "No upcoming session"}</span>
            </div>
            <ReadinessCell ready={!row.tasks.some((task: AdminRow) => task.category === "SESSION_RESOURCES" || task.category === "OTHER")} label={!row.tasks.some((task: AdminRow) => task.category === "SESSION_RESOURCES" || task.category === "OTHER") ? "Configured" : "Required"} />
            <ReadinessCell ready={!row.tasks.some((task: AdminRow) => task.category === "REMINDER_EMAILS" || task.category === "PARTICIPANT_LIST")} label={!row.tasks.some((task: AdminRow) => task.category === "REMINDER_EMAILS" || task.category === "PARTICIPANT_LIST") ? "Scheduled" : "Required"} muted={row.tasks.some((task: AdminRow) => task.category === "PARTICIPANT_LIST")} />
            <ReadinessCell ready={!row.tasks.some((task: AdminRow) => task.category === "SUPPORTING_DOCUMENTS")} label={!row.tasks.some((task: AdminRow) => task.category === "SUPPORTING_DOCUMENTS") ? "Confirmed" : "Pending"} />
            <StatusChip value={row.tasks.length ? "Action required" : "Ready"} />
          </button>
        ))}
      </div>
      {!loading && rows.length === 0 && (
        <EmptyState title="No readiness items" description="Calendar invite tasks are handled automatically; actionable cohort work will appear here." />
      )}
    </DashboardPanel>
  );
}

function ReadinessCell({ ready, label, muted = false }: { ready: boolean; label: string; muted?: boolean }) {
  return (
    <span className="dashboard-readiness-cell">
      <i className={ready ? "is-ready" : muted ? "is-muted" : "is-risk"} />
      {label}
    </span>
  );
}

function FutureAgendaPanel({ loading, sessions }: { loading: boolean; sessions: AdminRow[] }) {
  return (
    <DashboardPanel title="Upcoming Agenda" eyebrow="Next live moments" actionLabel="Next 4 events" className="dashboard-panel-agenda">
      <div className="dashboard-agenda-timeline">
        {sessions.slice(0, 4).map((session, index) => {
          const date = agendaDate(session.startTime);
          const name = presenterName(session);
          const headshotUrl = presenterHeadshotUrl(session);

          return (
            <div className="dashboard-agenda-item" key={session.id}>
              <span className={`dashboard-agenda-dot ${index === 0 ? "is-active" : ""}`} />
              <div className="dashboard-agenda-date" aria-label={shortDate(session.startTime)}>
                <strong>{date.day}</strong>
                <span>{date.month}</span>
              </div>
              <div className="dashboard-row-main">
                <span>{timeText(session.startTime)} · {name}</span>
                <strong title={session.title}>{session.title}</strong>
                <span title={session.cohort?.title}>{session.cohort?.title ?? "Cohort"}</span>
              </div>
              <span className="dashboard-presenter-avatar" title={name}>
                {headshotUrl ? <img src={String(headshotUrl)} alt={name} /> : presenterInitials(name)}
              </span>
            </div>
          );
        })}
      </div>
      {!loading && sessions.length === 0 && <EmptyState title="No upcoming sessions" description="Upcoming cohort sessions will appear here." />}
    </DashboardPanel>
  );
}

function PaymentSnapshot({ finance }: { finance: AdminRow }) {
  return (
    <DashboardPanel title="Payment Snapshot" className="dashboard-panel-payment">
      <div className="dashboard-payment-bars">
        <PaymentBar label="Collected" amount={finance.collected} total={finance.total} tone="primary" />
        <PaymentBar label="Pending" amount={finance.pending} total={finance.total} tone="secondary" />
        <PaymentBar label="Past Due" amount={finance.pastDue} total={finance.total} tone="danger" />
      </div>
      <div className="dashboard-payment-footer">
        <div>
          <strong>{formatMoney(finance.total)}</strong>
          <span>Total pipeline</span>
        </div>
        <div>
          <strong>{finance.total ? `${Math.round((finance.outstanding / finance.total) * 1000) / 10}%` : "0%"}</strong>
          <span>Outstanding rate</span>
        </div>
      </div>
    </DashboardPanel>
  );
}

function PaymentBar({ label, amount, total, tone }: { label: string; amount: number; total: number; tone: "primary" | "secondary" | "danger" }) {
  const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="dashboard-payment-bar">
      <div>
        <span className={tone === "danger" ? "is-danger" : ""}>{label}</span>
        <strong className={tone === "danger" ? "is-danger" : ""}>{formatMoney(amount)} <small>({percent}%)</small></strong>
      </div>
      <i><b className={`is-${tone}`} style={{ width: `${Math.min(100, percent)}%` }} /></i>
    </div>
  );
}

function RecentActivityPanel({ data, onOpenRegistration }: { data: AdminRow | null; onOpenRegistration: (id: string) => void }) {
  const activities = [
    ...(data?.recentRegistrations ?? []).slice(0, 3).map((registration: AdminRow) => ({
      id: `registration-${registration.id}`,
      icon: <GroupsOutlined />,
      title: `${formatProperDisplay(registration.primaryContactName)} registered for ${registration.cohort?.title ?? "a cohort"}`,
      subtitle: relativeTime(registration.createdAt),
      onClick: () => onOpenRegistration(registration.id)
    })),
    ...(data?.communicationIssues ?? []).slice(0, 2).map((issue: AdminRow) => ({
      id: `issue-${issue.id}`,
      icon: <EmailOutlined />,
      title: `${formatStatusLabel(issue.eventType)} email issue`,
      subtitle: [issue.communication?.cohort?.title, relativeTime(issue.createdAt)].filter(Boolean).join(" · "),
      href: "/communications" as Route
    })),
    ...(data?.recentActivity ?? []).slice(0, 3).map((activity: AdminRow) => ({
      id: `activity-${activity.id}`,
      icon: <MoreHorizIcon />,
      title: activity.description ?? `${formatStatusLabel(activity.action)} ${formatProperDisplay(activity.entityType)}`,
      subtitle: relativeTime(activity.createdAt)
    }))
  ].slice(0, 6);

  return (
    <DashboardPanel title="Recent Activity" href="/reports" actionLabel="View all" className="dashboard-panel-activity">
      <div className="dashboard-activity-list">
        {activities.map((activity) => {
          const content = (
            <>
              <span className="dashboard-activity-icon">{activity.icon}</span>
              <div className="dashboard-row-main">
                <strong>{activity.title}</strong>
                <span>{activity.subtitle}</span>
              </div>
            </>
          );

          if ("onClick" in activity && activity.onClick) {
            return <button type="button" className="dashboard-activity-item" key={activity.id} onClick={activity.onClick}>{content}</button>;
          }

          if ("href" in activity && activity.href) {
            return <Link className="dashboard-activity-item" key={activity.id} href={activity.href}>{content}</Link>;
          }

          return <div className="dashboard-activity-item" key={activity.id}>{content}</div>;
        })}
      </div>
    </DashboardPanel>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<AdminRow | null>(null);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [readinessCohort, setReadinessCohort] = useState<AdminRow | null>(null);
  const [recentRegistration, setRecentRegistration] = useState<AdminRow | null>(null);
  const [sendingTaskId, setSendingTaskId] = useState("");
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  useEffect(() => {
    setLoading(true);
    adminApi<AdminRow>("/api/admin-dashboard")
      .then((dashboardData) => setData(dashboardData))
      .catch((error) => notifyError(error.message))
      .finally(() => setLoading(false));
  }, [notifyError]);

  useEffect(() => {
    adminApi<AdminRow[]>("/api/communications/templates")
      .then((templateRows) => setTemplates(templateRows.filter((template) => template.active !== false)))
      .catch((error) => notifyError(error.message));
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

  const financeSummary = useMemo(() => {
    return (data?.paymentRecordsSnapshot ?? []).reduce(
      (summary: AdminRow, payment: AdminRow) => {
        const amount = Number(payment.amount ?? 0);
        const status = String(payment.status ?? "").toUpperCase();
        summary.total += amount;

        if (status === "PAID") {
          summary.collected += amount;
        } else if (status === "OVERDUE" || status === "FAILED") {
          summary.pastDue += amount;
          summary.outstanding += amount;
        } else {
          summary.pending += amount;
          summary.outstanding += amount;
        }

        return summary;
      },
      { total: 0, collected: 0, pending: 0, pastDue: 0, outstanding: 0 }
    );
  }, [data]);

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
    <PageStack className="dashboard-page">
      <MetricGrid data={data} finance={financeSummary} />
      {loading && <LoadingState label="Loading dashboard" />}

      <section className="dashboard-command-grid">
        <FutureAgendaPanel loading={loading} sessions={data?.upcomingSessions ?? []} />
        <PaymentSnapshot finance={financeSummary} />
      </section>

      <section className="dashboard-lower-grid">
        <PriorityPanel loading={loading} rows={readinessRows} onOpen={setReadinessCohort} />
        <RecentActivityPanel data={data} onOpenRegistration={openRecentRegistration} />
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
