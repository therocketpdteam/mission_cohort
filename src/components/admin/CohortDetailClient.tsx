"use client";

import { AddIcon } from "@/components/ui/icons";
import { ArrowRightLeftOutlined } from "@/components/ui/icons";
import { ArticleOutlined } from "@/components/ui/icons";
import { CalendarMonthOutlined, EmailOutlined, GroupsOutlined, InsightsOutlined } from "@/components/ui/icons";
import { CancelOutlined, CheckCircleOutline, SendOutlined } from "@/components/ui/icons";
import { ArchiveOutlined, DeleteOutline } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import { VisibilityOutlined } from "@/components/ui/icons";
import {
  Box,
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@/components/ui/primitives";
import { GridColDef } from "./common";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { formatProperDisplay, formatRegistrationPaymentStatus, formatRegistrationSource, formatStatusLabel, isCompedRegistration } from "@/lib/formatting";
import { formatDateInZone, formatDateTimeInZone, formatTimeInZone } from "@/lib/timezones";
import { buildSessionCalendarDescription } from "@/modules/calendar/description";
import { mergeFields, renderMergeFields, sampleMergeContext } from "@/modules/email/mergeFields";
import { textToEmailHtml } from "@/modules/email/templateFormatting";
import { exportParticipantsCsv } from "@/lib/participantCsv";
import { RosterWorkbench } from "./RosterWorkbench";
import { RegistrationPendingChangesPanel } from "./RegistrationPendingChangesPanel";
import { RegistrationDeliveryPreflight } from "./RegistrationDeliveryPreflight";
import { PocCommunicationHistory } from "./PocCommunicationHistory";
import { RegistrationCommunicationJourney } from "./RegistrationCommunicationJourney";
import { RegistrationEditor, RegistrationRemovalDialog } from "./RegistrationsClient";
import type { ParsedRosterParticipant } from "@/lib/rosterParser";
import {
  AdminRow,
  AppDataGrid,
  CompactFilterBar,
  DateBadge,
  DetailField,
  EmptyState,
  FieldConfig,
  GridRowSelectionModel,
  MutationDialog,
  PageHeader,
  PageStack,
  QuickViewDrawer,
  RowActionMenu,
  SectionCard,
  StatusChip,
  TableShell,
  cohortDropdownLabel,
  useNotifier
} from "./common";

const sessionFields: FieldConfig[] = [
  { name: "title", label: "Session title", required: true },
  {
    name: "description",
    label: "Calendar invite description",
    type: "textarea",
    placeholder: "Add the session context, preparation notes, or agenda attendees should see.",
    helperText: "This appears inside the Google Calendar event and its invitation details."
  },
  { name: "sessionNumber", label: "Session number", type: "number", required: true },
  { name: "startTime", label: "Start time", type: "datetime-local", required: true },
  { name: "endTime", label: "End time", type: "datetime-local", required: true },
  { name: "timezone", label: "Timezone", required: true },
  {
    name: "meetingUrl",
    label: "Zoom / meeting link",
    placeholder: "https://zoom.us/j/...",
    helperText: "Mission Control appends this link to the calendar description and uses it as the event location when no location is provided."
  },
  { name: "location", label: "Location (optional)", placeholder: "Online, room name, or physical address" }
];

const participantMessageMergeFields = mergeFields.filter((field) => (
  field.startsWith("participant.") ||
  field.startsWith("registration.") ||
  field.startsWith("organization.") ||
  ["cohort.title", "cohort.shortName", "cohort.description", "cohort.guideTopic", "cohort.guideUrl", "cohort.podcastUrl", "cohort.presenterName", "cohort.presenterEmail"].includes(field)
));

function sortedScheduleSessions(sessions: AdminRow[]) {
  return [...sessions]
    .filter((session) => session.startTime)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

function formatScheduleDateRange(sessions: AdminRow[], cohort?: AdminRow | null) {
  const sortedSessions = sortedScheduleSessions(sessions);
  const firstSession = sortedSessions[0];
  const lastSession = sortedSessions.at(-1);

  if (firstSession && lastSession) {
    const startTimezone = firstSession.timezone ?? cohort?.defaultTimezone;
    const endTimezone = lastSession.timezone ?? startTimezone;
    const start = formatDateInZone(firstSession.startTime, startTimezone, { month: "numeric", day: "numeric", year: "numeric" });
    const end = formatDateInZone(lastSession.endTime ?? lastSession.startTime, endTimezone, { month: "numeric", day: "numeric", year: "numeric" });
    return `${start} - ${end}`;
  }

  const start = cohort?.startDate ? formatDateInZone(cohort.startDate, cohort.defaultTimezone, { month: "numeric", day: "numeric", year: "numeric" }) : "";
  const end = cohort?.endDate ? formatDateInZone(cohort.endDate, cohort.defaultTimezone, { month: "numeric", day: "numeric", year: "numeric" }) : "";
  return start || end ? `${start || "-"} - ${end || "-"}` : "-";
}

function zoomLinkOverview(sessions: AdminRow[]) {
  const total = sessions.length;
  const linked = sessions.filter((session) => String(session.meetingUrl ?? "").trim());
  const firstLink = linked[0]?.meetingUrl ? String(linked[0].meetingUrl) : "";

  if (total === 0) {
    return { value: "No sessions", helper: "Add sessions before Zoom links", href: "" };
  }

  return {
    value: `${linked.length}/${total} session link${total === 1 ? "" : "s"} ready`,
    helper: linked.length === total ? "Used in calendar invites, 24-hour emails, and 60-minute emails" : "Add Zoom links to each session",
    href: firstLink
  };
}

function cohortPresenterName(cohort?: AdminRow | null) {
  return [cohort?.presenter?.firstName, cohort?.presenter?.lastName].filter(Boolean).join(" ");
}

function OverviewResourceCard({
  label,
  value,
  icon,
  linkLabel,
  helper,
  href
}: {
  label: string;
  value?: unknown;
  icon: ReactNode;
  linkLabel?: string;
  helper?: string;
  href?: string;
}) {
  const text = String(value ?? "").trim();
  const linkHref = href || (/^https?:\/\//i.test(text) ? text : "");

  return (
    <div className="cohort-overview-resource-card">
      <span className="cohort-overview-resource-icon">{icon}</span>
      <div>
        <small>{label}</small>
        {text ? (
          linkHref ? (
            <>
              <a href={linkHref} target="_blank" rel="noreferrer">{linkLabel ?? "Open link"}</a>
              <span>{text}</span>
            </>
          ) : <strong>{text}</strong>
        ) : <span>-</span>}
        {helper ? <em>{helper}</em> : null}
      </div>
    </div>
  );
}

type ParticipantMessageSendResponse = {
  communications?: Array<{ status?: string; providerError?: string | null }>;
  recipientCount?: number;
};

const taskFields: FieldConfig[] = [
  { name: "title", label: "Task title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  {
    name: "category",
    label: "Category",
    type: "select",
    options: [
      "PARTICIPANT_LIST",
      "PAYMENT_FOLLOW_UP",
      "CALENDAR_INVITE",
      "REMINDER_EMAILS",
      "SESSION_RESOURCES",
      "RECORDING_LINK",
      "POST_SESSION_FOLLOW_UP",
      "SUPPORTING_DOCUMENTS",
      "QUICKBOOKS_REVIEW",
      "OTHER"
    ].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  },
  { name: "priority", label: "Priority", type: "select", options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => ({ label: formatStatusLabel(value), value })) },
  { name: "dueDate", label: "Due date", type: "datetime-local" },
  { name: "ownerName", label: "Owner" }
];

function resourceFieldsForSessions(sessions: AdminRow[]): FieldConfig[] {
  return [
  { name: "title", label: "Title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  {
    name: "sessionId",
    label: "Session",
    type: "select",
    options: [
      { label: "Cohort-level material", value: "" },
      ...sessions.map((session) => ({ label: `${session.sessionNumber}. ${session.title}`, value: session.id }))
    ]
  },
  {
    name: "type",
    label: "Type",
    type: "select",
    options: ["VIDEO", "SLIDES", "PDF", "LINK", "WORKBOOK", "OTHER"].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  },
  { name: "url", label: "URL" },
  { name: "muxAssetId", label: "Mux asset ID" },
  { name: "muxPlaybackId", label: "Mux playback ID" },
  {
    name: "visibility",
    label: "Visibility",
    type: "select",
    options: ["ADMIN_ONLY", "PARTICIPANTS", "PUBLIC_LINK"].map((value) => ({ label: formatStatusLabel(value), value })),
    required: true
  }
  ];
}

const sessionEmailTypes = [
  { type: "WEEK_BEFORE_REMINDER", label: "1 Week" },
  { type: "DAY_BEFORE_REMINDER", label: "24h" },
  { type: "HOUR_BEFORE_REMINDER", label: "60m" },
  { type: "FOLLOW_UP", label: "24h Post" }
];

function sessionEmailTypesForSession(sessionNumber?: number | null) {
  const normalizedSessionNumber = Number(sessionNumber ?? 1);
  return normalizedSessionNumber <= 1
    ? sessionEmailTypes
    : sessionEmailTypes.filter((template) => template.type !== "WEEK_BEFORE_REMINDER");
}

const paymentStatuses = ["PENDING", "INVOICED", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"];
const participantStatuses = ["REGISTERED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const rosterStatuses = ["NOT_REQUESTED", "NEEDED", "PARTIAL", "COMPLETE"];
const invoiceStatuses = ["DRAFT", "SENT", "PAID", "VOIDED", "CANCELLED"];
const payoutStatuses = ["PLANNED", "PARTIAL", "PAID", "CANCELLED"];

type FinanceHealth = {
  sendgridReady: boolean;
  storageReady: boolean;
  privateBucketReady: boolean;
  checkedAt?: string;
};

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString()}`;
}

function moneyNumber(value: unknown) {
  return Number(value ?? 0);
}

function registrationRelatedRows(registration: AdminRow, rows: AdminRow[] | undefined, fallbackKey: "paymentRecords" | "invoiceDrafts") {
  const related = rows?.filter((row) => row.registrationId === registration.id);
  return related?.length ? related : ((registration[fallbackKey] ?? []) as AdminRow[]);
}

function registrationCollectedAmount(registration: AdminRow, paymentRows?: AdminRow[], invoiceRows?: AdminRow[]) {
  if (isCompedRegistration(registration)) {
    return 0;
  }

  const paidFromRecords = registrationRelatedRows(registration, paymentRows, "paymentRecords")
    .filter((payment) => ["PAID", "PARTIALLY_PAID"].includes(String(payment.status ?? "").toUpperCase()))
    .reduce((sum, payment) => sum + moneyNumber(payment.amount), 0);
  const paidFromInvoices = registrationRelatedRows(registration, invoiceRows, "invoiceDrafts")
    .reduce((sum, invoice) => sum + moneyNumber(invoice.paidAmount), 0);
  const explicitPaid = Math.max(paidFromRecords, paidFromInvoices);

  if (explicitPaid > 0) {
    return explicitPaid;
  }

  return String(registration.paymentStatus ?? "").toUpperCase() === "PAID" ? moneyNumber(registration.totalAmount) : 0;
}

function registrationBillingStatus(registration: AdminRow, paymentRows?: AdminRow[], invoiceRows?: AdminRow[]) {
  const paymentStatus = String(registration.paymentStatus ?? "").toUpperCase();
  const registrationStatus = String(registration.status ?? "").toUpperCase();
  const total = moneyNumber(registration.totalAmount);
  const collected = registrationCollectedAmount(registration, paymentRows, invoiceRows);

  if (registration.archivedAt || registrationStatus === "CANCELLED") {
    return "Withdrawn";
  }

  if (isCompedRegistration(registration)) {
    return "Free";
  }

  if (total > 0 && collected >= total) {
    return "Paid";
  }

  if (collected > 0 || paymentStatus === "PARTIALLY_PAID") {
    return "Partial Paid";
  }

  if (["CANCELLED", "REFUNDED"].includes(paymentStatus)) {
    return "Uncollectable";
  }

  return "Invoiced";
}

function registrationRosterStatus(registration: AdminRow) {
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

function formatDate(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US") : "-";
}

function dateInputValue(value: unknown) {
  return value ? new Date(value as string | Date).toISOString().slice(0, 10) : "";
}

function numericInputValue(value: unknown) {
  return Number(value ?? 0);
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

function resourceHref(resource: AdminRow) {
  if (resource.url) {
    return resource.url;
  }

  if (resource.muxPlaybackId) {
    return `https://stream.mux.com/${resource.muxPlaybackId}`;
  }

  return "";
}

function splitContactName(value?: string | null) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "Participant",
    lastName: parts.length > 1 ? parts.at(-1)! : "-"
  };
}

type RegistrationTrendPoint = {
  label: string;
  date: Date;
  timestamp: number;
  value: number;
  seats: number;
  amount: number;
  cumulativeSeats: number;
  cumulativeAmount: number;
  registrant: string;
  organization: string;
};

function registrationTrendPoints(rows: AdminRow[], mode: "count" | "amount"): RegistrationTrendPoint[] {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let cumulativeSeats = 0;
  let cumulativeAmount = 0;

  return sorted.map((registration) => {
    const date = new Date(registration.createdAt);
    const seats = Number(registration.participantCount ?? 0);
    const amount = Number(registration.totalAmount ?? 0);
    cumulativeSeats += seats;
    cumulativeAmount += amount;

    return {
      label: date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }),
      date,
      timestamp: date.getTime(),
      value: mode === "count" ? cumulativeSeats : cumulativeAmount,
      seats,
      amount,
      cumulativeSeats,
      cumulativeAmount,
      registrant: formatProperDisplay(registration.primaryContactName ?? registration.billingContactName ?? "Registration"),
      organization: formatProperDisplay(registration.organization?.name ?? registration.organizationName ?? "Organization")
    };
  });
}

function niceAxisTicks(maxValue: number, targetTicks = 5) {
  const safeMax = Math.max(maxValue, 1);
  const roughStep = safeMax / Math.max(targetTicks - 1, 1);
  const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / power;
  const niceNormalized =
    normalized <= 1 ? 1 :
    normalized <= 2 ? 2 :
    normalized <= 2.5 ? 2.5 :
    normalized <= 5 ? 5 :
    10;
  const step = niceNormalized * power;
  const top = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];

  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }

  return { ticks, top };
}

function dateAxisTicks(points: RegistrationTrendPoint[], maxTicks = 5) {
  if (points.length <= 1) {
    return points.map((point) => ({ timestamp: point.timestamp, label: point.label }));
  }

  const start = points[0].timestamp;
  const end = points.at(-1)?.timestamp ?? start;
  const count = Math.min(maxTicks, Math.max(2, points.length));
  const formatter = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" });

  return Array.from({ length: count }, (_item, index) => {
    const timestamp = start + ((end - start) * index) / Math.max(count - 1, 1);
    return { timestamp, label: formatter.format(new Date(timestamp)) };
  });
}

function smoothPathForPoints(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6
    };

    commands.push(`C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`);
  }

  return commands.join(" ");
}

function RegistrationEvolutionChart({
  rows,
  compareRows,
  compareLabel,
  mode
}: {
  rows: AdminRow[];
  compareRows: AdminRow[];
  compareLabel?: string;
  mode: "count" | "amount";
}) {
  const points = useMemo(() => registrationTrendPoints(rows, mode), [mode, rows]);
  const comparisonPoints = useMemo(() => registrationTrendPoints(compareRows, mode), [compareRows, mode]);
  const allPoints = [...points, ...comparisonPoints];
  const max = Math.max(...allPoints.map((point) => point.value), 1);
  const { ticks: yTicks, top: yMax } = niceAxisTicks(max, 5);
  const width = 820;
  const height = 260;
  const margin = { top: 22, right: 28, bottom: 42, left: 78 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const startTimestamp = Math.min(...allPoints.map((point) => point.timestamp));
  const endTimestamp = Math.max(...allPoints.map((point) => point.timestamp));
  const timeRange = endTimestamp - startTimestamp;
  const xTicks = dateAxisTicks(points.length ? points : comparisonPoints, 5);

  function xFor(point: RegistrationTrendPoint, index: number, total: number) {
    const ratio = timeRange > 0
      ? (point.timestamp - startTimestamp) / timeRange
      : total <= 1 ? 0.5 : index / Math.max(total - 1, 1);
    return margin.left + ratio * innerWidth;
  }

  function xForTimestamp(timestamp: number) {
    const ratio = timeRange > 0 ? (timestamp - startTimestamp) / timeRange : 0.5;
    return margin.left + ratio * innerWidth;
  }

  function yFor(value: number) {
    return margin.top + innerHeight - (value / yMax) * innerHeight;
  }

  function chartPoints(nextPoints: RegistrationTrendPoint[]) {
    return nextPoints.map((point, index) => ({
      point,
      x: xFor(point, index, nextPoints.length),
      y: yFor(point.value)
    }));
  }

  function pathFor(nextPoints: RegistrationTrendPoint[]) {
    return smoothPathForPoints(chartPoints(nextPoints));
  }

  function yTickLabel(value: number) {
    return mode === "count" ? `${value.toLocaleString()} seats` : money(value);
  }

  if (points.length === 0) {
    return <EmptyState title="No registration trend yet" description="Registrations will draw the cohort evolution chart here." />;
  }

  return (
    <div className="cohort-evolution-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Registration evolution chart">
        {yTicks.map((tick) => {
          const y = yFor(tick);

          return (
            <g key={`y-${tick}`}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="var(--color-slate-200)" strokeDasharray={tick === 0 ? undefined : "4 8"} />
              <text x={margin.left - 10} y={y + 4} fill="var(--color-slate-500)" fontSize="11" textAnchor="end">{yTickLabel(tick)}</text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = xForTimestamp(tick.timestamp);

          return (
            <g key={`x-${tick.timestamp}`}>
              <line x1={x} y1={margin.top} x2={x} y2={height - margin.bottom} stroke="var(--color-slate-100)" />
              <text x={x} y={height - 14} fill="var(--color-slate-500)" fontSize="11" textAnchor="middle">{tick.label}</text>
            </g>
          );
        })}
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke="var(--color-slate-300)" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke="var(--color-slate-300)" />
        {comparisonPoints.length > 0 && <path d={pathFor(comparisonPoints)} fill="none" stroke="var(--color-slate-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 8" />}
        <path d={pathFor(points)} fill="none" stroke="var(--color-blue-600)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {chartPoints(points).map(({ point, x, y }, index) => (
          <circle key={`${point.timestamp}-${index}`} cx={x} cy={y} r="3.4" fill="var(--color-orange-500)" stroke="var(--color-white)" strokeWidth="1.4">
            <title>
              {`${point.label}
${point.registrant} · ${point.organization}
Registration: ${point.seats.toLocaleString()} seat${point.seats === 1 ? "" : "s"} · ${money(point.amount)}
Aggregate seats: ${point.cumulativeSeats.toLocaleString()}
Aggregate registration value: ${money(point.cumulativeAmount)}`}
            </title>
          </circle>
        ))}
      </svg>
      {comparisonPoints.length > 0 && <span>Comparing against {compareLabel}</span>}
    </div>
  );
}

function FinanceSnapshotCard({
  totalAmount,
  paidAmount,
  projectReturn
}: {
  totalAmount: number;
  paidAmount: number;
  projectReturn?: number;
}) {
  const invoicedAmount = Math.max(totalAmount - paidAmount, 0);
  const collectedPercent = totalAmount > 0 ? Math.min(100, Math.round((paidAmount / totalAmount) * 100)) : 0;

  return (
    <article
      className="cohort-finance-wow-card revenue-snapshot-card"
      style={{
        "--paid": `${collectedPercent}%`,
        "--pending": "100%"
      } as CSSProperties}
    >
      <div className="finance-wow-copy">
        <span className="cohort-metric-label">Revenue Snapshot</span>
        <strong>{money(totalAmount)}</strong>
        <p>
          {collectedPercent}% paid · {money(invoicedAmount)} invoiced
          {typeof projectReturn === "number" ? ` · ${money(projectReturn)} project return` : ""}
        </p>
      </div>
      <div className="finance-wow-visual" aria-label={`${collectedPercent}% collected`}>
        <div className="finance-wow-ring">
          <span>{collectedPercent}%</span>
          <small>paid</small>
        </div>
      </div>
      <div className="finance-wow-bars" aria-hidden="true">
        <span className="is-paid" />
        <span className="is-pending" />
      </div>
      <div className="finance-wow-values">
        <DetailField label="Paid" value={money(paidAmount)} />
        <DetailField label="Invoiced" value={money(invoicedAmount)} />
      </div>
    </article>
  );
}

function ProjectReturnCard({ distribution }: { distribution: AdminRow }) {
  const paidRatio = Math.round(Number(distribution.totals?.paymentRatio ?? 0) * 100);

  return (
    <article
      className="cohort-finance-wow-card distribution-card-main"
      style={{
        "--paid": `${paidRatio}%`,
        "--pending": `${Math.min(100, paidRatio + Math.round(Number(distribution.distribution?.commissionPercent ?? 30)))}%`
      } as CSSProperties}
    >
      <div className="finance-wow-copy">
        <span className="cohort-metric-label">Project Return</span>
        <strong>{money(distribution.totals?.projectReturn)}</strong>
        <p>{paidRatio}% paid in · {money(distribution.totals?.pendingPayout)} pending TL payout</p>
      </div>
      <div className="finance-wow-visual">
        <div className="finance-wow-ring">
          <span>{distribution.totals?.returnPercent ?? 0}%</span>
          <small>return</small>
        </div>
      </div>
      <div className="finance-wow-bars" aria-hidden="true">
        <span className="is-paid" />
        <span className="is-pending" />
        <span className="is-open" />
      </div>
      <div className="finance-wow-values">
        <DetailField label="Sold" value={money(distribution.totals?.soldAmount)} />
        <DetailField label="Paid In" value={money(distribution.totals?.paidAmount)} />
        <DetailField label="RPD Share" value={money(distribution.totals?.commissionAmount)} />
        <DetailField label="TL Share" value={money(distribution.totals?.tlShareAmount)} />
      </div>
    </article>
  );
}

function PaymentDetailDialog({
  payment,
  cohortId,
  templates,
  open,
  onClose,
  onChanged,
  onError
}: {
  payment: AdminRow | null;
  cohortId: string;
  templates: AdminRow[];
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<AdminRow | null>(null);

  useEffect(() => {
    if (payment) {
      setStatus(payment.status ?? "PENDING");
      setInvoiceNumber(payment.invoiceNumber ?? payment.registration?.invoiceNumber ?? "");
      setPurchaseOrderNumber(payment.registration?.purchaseOrderNumber ?? "");
    }
  }, [payment]);

  async function updatePayment() {
    if (!payment) {
      return;
    }

    try {
      await adminApi("/api/payments", {
        method: "PATCH",
        body: { id: payment.id, status, invoiceNumber }
      });

      if (payment.registrationId) {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: { id: payment.registrationId, paymentStatus: status, invoiceNumber, purchaseOrderNumber }
        });
      }

      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function sendReminder() {
    if (!payment?.registrationId) {
      return;
    }

    try {
      const reminder = templates.find((template) => template.type === "PAYMENT_REMINDER" && template.active) ?? templates.find((template) => template.active);
      if (!reminder) {
        throw new Error("No active email template is available for payment reminders.");
      }

      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToRegistrations", templateId: reminder.id, registrationIds: [payment.registrationId] }
      });
      await onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>Payment Detail</DialogTitle>
        <DialogContent>
          {payment ? (
            <Grid container spacing={2}>
              {[
                ["Organization", payment.organization?.name ?? payment.registration?.organization?.name ?? "-"],
                ["Billing / POC", payment.registration?.billingContactName ?? payment.registration?.primaryContactName ?? "-"],
                ["Phone", payment.registration?.primaryContactPhone ?? payment.organization?.phone ?? "-"],
                ["Address", payment.registration?.billingAddress ?? payment.organization?.addressLine1 ?? "-"],
                ["Method", payment.method ?? payment.registration?.paymentMethod ?? "-"],
                ["Amount", money(payment.amount)],
                ["QuickBooks Sync", payment.quickBooksSyncStatus ?? payment.registration?.quickBooksSyncStatus ?? "NOT_SYNCED"],
                ["Last Touch Sent", payment.emailSummary?.lastEmailEventAt ? new Date(payment.emailSummary.lastEmailEventAt).toLocaleString("en-US") : "-"]
              ].map(([label, value]) => (
                <Grid size={{ xs: 12, sm: 6 }} key={label}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography>{value}</Typography>
                </Grid>
              ))}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField select fullWidth label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="Invoice number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="PO number" value={purchaseOrderNumber} onChange={(event) => setPurchaseOrderNumber(event.target.value)} />
              </Grid>
            </Grid>
          ) : (
            <Typography color="text.secondary">No payment selected.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={async () => {
              if (!payment) return;
              try {
                const draft = await adminApi<AdminRow>("/api/invoices", {
                  method: "POST",
                  body: {
                    cohortId,
                    registrationId: payment.registrationId,
                    organizationId: payment.organizationId,
                    invoiceNumber,
                    purchaseOrderNumber,
                    paidAmount: payment.status === "PAID" ? payment.amount : 0
                  }
                });
                const withPdf = await adminApi<AdminRow>("/api/invoices", { method: "PATCH", body: { action: "generatePdf", id: draft.id } });
                setInvoiceDraft(withPdf);
                setDraftOpen(true);
                await onChanged();
              } catch (error) {
                onError((error as Error).message);
              }
            }}
          >
            Generate Invoice Draft
          </Button>
          <Button variant="outlined" onClick={sendReminder}>Send Reminder</Button>
          <Button variant="outlined" onClick={onClose}>Close</Button>
          <Button onClick={updatePayment}>Save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={draftOpen} onClose={() => setDraftOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Invoice Draft</DialogTitle>
        <DialogContent>
          {invoiceDraft ? (
            <div className="quick-view-grid">
              <DetailField label="Invoice" value={invoiceDraft.invoiceNumber ?? invoiceDraft.id} />
              <DetailField label="Status" value={formatStatusLabel(invoiceDraft.status)} />
              <DetailField label="Total" value={money(invoiceDraft.totalAmount)} />
              <DetailField label="Paid" value={money(invoiceDraft.paidAmount)} />
              <DetailField label="PDF" value={invoiceDraft.pdfUrl ? "Generated" : "Pending"} />
            </div>
          ) : (
            <Typography color="text.secondary">Generate an invoice draft to preview the saved PDF status here.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          {invoiceDraft?.pdfUrl && <Button href={invoiceDraft.pdfUrl} variant="outlined" target="_blank" rel="noreferrer">Open PDF</Button>}
          {invoiceDraft && (
            <Button
              variant="outlined"
              onClick={async () => {
                try {
                  const receipt = await adminApi<AdminRow>("/api/invoices", { method: "PATCH", body: { action: "generatePdf", id: invoiceDraft.id, receipt: true } });
                  setInvoiceDraft(receipt);
                } catch (error) {
                  onError((error as Error).message);
                }
              }}
            >
              Generate Receipt
            </Button>
          )}
          <Button onClick={() => setDraftOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

type InvoiceLineItemState = {
  description: string;
  quantity: number;
  unitAmount: number;
};

function invoiceLineTotal(item: InvoiceLineItemState) {
  return Number(item.quantity ?? 0) * Number(item.unitAmount ?? 0);
}

function InvoiceEditorDialog({
  cohortId,
  invoice,
  seedRegistration,
  registrations,
  open,
  onClose,
  onSaved,
  onError
}: {
  cohortId: string;
  invoice: AdminRow | null;
  seedRegistration: AdminRow | null;
  registrations: AdminRow[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [registrationId, setRegistrationId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [issueDate, setIssueDate] = useState(dateInputValue(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [paidAmount, setPaidAmount] = useState(0);
  const [taxAmount, setTaxAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [quickBooksCustomerRef, setQuickBooksCustomerRef] = useState("");
  const [quickBooksInvoiceRef, setQuickBooksInvoiceRef] = useState("");
  const [quickBooksRealmId, setQuickBooksRealmId] = useState("");
  const [lineItems, setLineItems] = useState<InvoiceLineItemState[]>([{ description: "Cohort registration seats", quantity: 1, unitAmount: 0 }]);
  const selectedRegistration = registrations.find((registration) => registration.id === registrationId);
  const subtotalAmount = lineItems.reduce((sum, item) => sum + invoiceLineTotal(item), 0);
  const totalAmount = subtotalAmount + Number(taxAmount ?? 0);
  const balanceAmount = Math.max(totalAmount - Number(paidAmount ?? 0), 0);
  const invoiceRecipient = selectedRegistration
    ? [
        selectedRegistration.billingContactEmail || selectedRegistration.primaryContactEmail,
        selectedRegistration.billingContactEmail && selectedRegistration.primaryContactEmail && selectedRegistration.billingContactEmail !== selectedRegistration.primaryContactEmail
          ? selectedRegistration.primaryContactEmail
          : ""
      ].filter(Boolean).join(", ")
    : "Cohort-level invoice; choose a registration to send to billing/POC contacts.";

  useEffect(() => {
    const row = invoice;
    const seed = seedRegistration;
    setRegistrationId(row?.registrationId ?? seed?.id ?? "");
    setInvoiceNumber(row?.invoiceNumber ?? "");
    setPurchaseOrderNumber(row?.purchaseOrderNumber ?? seed?.purchaseOrderNumber ?? "");
    setIssueDate(dateInputValue(row?.issueDate ?? new Date()));
    setDueDate(dateInputValue(row?.dueDate));
    setStatus(row?.status ?? "DRAFT");
    setPaidAmount(numericInputValue(row?.paidAmount));
    setTaxAmount(numericInputValue(row?.taxAmount));
    setNotes(row?.notes ?? "");
    setQuickBooksCustomerRef(row?.quickBooksCustomerRef ?? seed?.quickBooksCustomerRef ?? "");
    setQuickBooksInvoiceRef(row?.quickBooksInvoiceRef ?? seed?.quickBooksInvoiceRef ?? "");
    setQuickBooksRealmId(row?.quickBooksRealmId ?? seed?.quickBooksRealmId ?? "");
    setLineItems(
      row?.lineItems?.length
        ? row.lineItems.map((item: AdminRow) => ({
            description: item.description ?? "Cohort registration seats",
            quantity: numericInputValue(item.quantity) || 1,
            unitAmount: numericInputValue(item.unitAmount)
          }))
        : [{
            description: seed ? `${seed.organization?.name ?? "Organization"} cohort seats` : "Cohort registration seats",
            quantity: numericInputValue(seed?.participantCount) || 1,
            unitAmount: seed?.participantCount ? numericInputValue(seed.totalAmount) / Math.max(numericInputValue(seed.participantCount), 1) : 0
          }]
    );
  }, [invoice, seedRegistration, open]);

  function updateLineItem(index: number, field: keyof InvoiceLineItemState, value: string) {
    setLineItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: field === "description" ? value : Number(value) } : item));
  }

  async function save() {
    try {
      const payload = {
        id: invoice?.id,
        cohortId,
        registrationId: registrationId || undefined,
        organizationId: selectedRegistration?.organizationId ?? invoice?.organizationId,
        invoiceNumber: invoiceNumber || undefined,
        purchaseOrderNumber: purchaseOrderNumber || undefined,
        issueDate: issueDate || undefined,
        dueDate: dueDate || undefined,
        status,
        paidAmount,
        taxAmount,
        notes: notes || undefined,
        quickBooksCustomerRef: quickBooksCustomerRef || undefined,
        quickBooksInvoiceRef: quickBooksInvoiceRef || undefined,
        quickBooksRealmId: quickBooksRealmId || undefined,
        lineItems: lineItems.filter((item) => item.description.trim()).map((item) => ({
          description: item.description.trim(),
          quantity: Math.max(1, Number(item.quantity ?? 1)),
          unitAmount: Number(item.unitAmount ?? 0)
        }))
      };

      if (payload.lineItems.length === 0) {
        throw new Error("Add at least one invoice line item.");
      }

      if (invoice?.id) {
        await adminApi("/api/invoices", { method: "PATCH", body: payload });
      } else {
        await adminApi("/api/invoices", { method: "POST", body: payload });
      }

      await onSaved();
      onClose();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      BackdropProps={{ className: "invoice-modal-backdrop" }}
      PaperProps={{ className: "invoice-editor-modal" }}
    >
      <DialogTitle>{invoice ? "Edit Invoice Draft" : "Create Invoice"}</DialogTitle>
      <DialogContent className="invoice-editor-body">
        <div className="invoice-editor-hero">
          <div>
            <span>{invoice ? "Existing draft" : "New draft"}</span>
            <strong>{invoiceNumber || "Auto number on save"}</strong>
            <p>{invoiceRecipient}</p>
          </div>
          <div className="invoice-editor-totals">
            <DetailField label="Subtotal" value={money(subtotalAmount)} />
            <DetailField label="Tax" value={money(taxAmount)} />
            <DetailField label="Total" value={money(totalAmount)} />
            <DetailField label="Balance" value={money(balanceAmount)} />
          </div>
        </div>
        <div className="finance-dialog-grid">
          <TextField select fullWidth label="Registration" value={registrationId} onChange={(event) => setRegistrationId(event.target.value)}>
            <MenuItem value="">Cohort-level invoice</MenuItem>
            {registrations.filter((registration) => !registration.archivedAt).map((registration) => (
              <MenuItem value={registration.id} key={registration.id}>
                {formatProperDisplay(registration.organization?.name ?? registration.primaryContactName)}
              </MenuItem>
            ))}
          </TextField>
          <TextField fullWidth label="Invoice number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Auto generated" />
          <TextField fullWidth label="PO number" value={purchaseOrderNumber} onChange={(event) => setPurchaseOrderNumber(event.target.value)} />
          <TextField select fullWidth label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {invoiceStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
          </TextField>
          <TextField fullWidth label="Issue date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField fullWidth label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField fullWidth label="Paid amount" type="number" value={paidAmount} onChange={(event) => setPaidAmount(Number(event.target.value))} />
          <TextField fullWidth label="Tax amount" type="number" value={taxAmount} onChange={(event) => setTaxAmount(Number(event.target.value))} />
        </div>
        <div className="invoice-line-editor">
          <div className="section-inline-header">
            <Typography variant="subtitle2">Line items</Typography>
            <Button variant="outlined" size="small" onClick={() => setLineItems((items) => [...items, { description: "", quantity: 1, unitAmount: 0 }])}>Add line</Button>
          </div>
          {lineItems.map((item, index) => (
            <div className="invoice-line-row" key={`${index}-${item.description}`}>
              <TextField label="Description" value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} />
              <TextField label="Qty" type="number" value={item.quantity} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} />
              <TextField label="Unit" type="number" value={item.unitAmount} onChange={(event) => updateLineItem(index, "unitAmount", event.target.value)} />
              <DetailField label="Line total" value={money(invoiceLineTotal(item))} />
              <Button
                variant="text"
                color="error"
                onClick={() => setLineItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                disabled={lineItems.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="invoice-accounting-panel">
          <div>
            <Typography variant="subtitle2">Accounting references</Typography>
            <Typography variant="body2" color="text.secondary">QuickBooks customer ref is the cohort Project ref. Organizations stay in the invoice description.</Typography>
          </div>
          <div className="finance-dialog-grid">
            <TextField fullWidth label="QuickBooks customer ref" value={quickBooksCustomerRef} onChange={(event) => setQuickBooksCustomerRef(event.target.value)} />
            <TextField fullWidth label="QuickBooks invoice ref" value={quickBooksInvoiceRef} onChange={(event) => setQuickBooksInvoiceRef(event.target.value)} />
            <TextField fullWidth label="QuickBooks realm" value={quickBooksRealmId} onChange={(event) => setQuickBooksRealmId(event.target.value)} />
          </div>
        </div>
        <TextField fullWidth multiline minRows={3} label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        {invoice && (invoice.pdfUrl || invoice.receiptUrl) && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Saving printable invoice changes will mark existing PDFs and receipts as needing regeneration.
          </Alert>
        )}
      </DialogContent>
      <DialogActions className="invoice-editor-actions">
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save invoice</Button>
      </DialogActions>
    </Dialog>
  );
}

function PayoutEditorDialog({
  cohortId,
  payout,
  payments,
  open,
  onClose,
  onSaved,
  onError
}: {
  cohortId: string;
  payout: AdminRow | null;
  payments: AdminRow[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState("PLANNED");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentRecordId, setPaymentRecordId] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentFileKey, setAttachmentFileKey] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setAmount(numericInputValue(payout?.amount));
    setStatus(payout?.status ?? "PLANNED");
    setPaymentDate(dateInputValue(payout?.paymentDate));
    setPaymentRecordId(payout?.paymentRecordId ?? "");
    setNotes(payout?.notes ?? "");
    setAttachmentFileKey(payout?.attachmentFileKey ?? "");
    setAttachmentUrl(payout?.attachmentUrl ?? "");
  }, [payout, open]);

  async function uploadProof(file?: File) {
    if (!file) {
      return;
    }

    setUploading(true);
    try {
      const upload = await uploadAdminFile<AdminRow>(file, "payout-proof");
      setAttachmentFileKey(upload.fileKey ?? "");
      setAttachmentUrl(upload.url ?? "");
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    try {
      const body = {
        ...(payout?.id ? { action: "updatePayout", id: payout.id } : { cohortId }),
        paymentRecordId: paymentRecordId || undefined,
        amount,
        status,
        paymentDate: paymentDate || undefined,
        attachmentFileKey: attachmentFileKey || undefined,
        attachmentUrl: attachmentUrl || undefined,
        notes: notes || undefined
      };

      await adminApi("/api/distributions", { method: payout?.id ? "PATCH" : "POST", body });
      await onSaved();
      onClose();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{payout ? "Edit Payout" : "Create Payout"}</DialogTitle>
      <DialogContent>
        <div className="finance-dialog-grid">
          <TextField fullWidth label="Amount" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
          <TextField select fullWidth label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {payoutStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
          </TextField>
          <TextField fullWidth label="Payment date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select fullWidth label="Linked incoming payment" value={paymentRecordId} onChange={(event) => setPaymentRecordId(event.target.value)}>
            <MenuItem value="">No direct payment link</MenuItem>
            {payments.map((payment) => (
              <MenuItem value={payment.id} key={payment.id}>
                {formatProperDisplay(payment.organization?.name ?? payment.registration?.organization?.name ?? "Payment")} · {money(payment.amount)}
              </MenuItem>
            ))}
          </TextField>
        </div>
        <TextField fullWidth multiline minRows={3} label="Note" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <div className="finance-upload-row">
          <Button variant="outlined" component="label" disabled={uploading}>
            {uploading ? "Uploading..." : attachmentUrl ? "Replace proof" : "Upload proof"}
            <input hidden type="file" onChange={(event) => void uploadProof(event.target.files?.[0])} />
          </Button>
          {attachmentUrl && <Button href={attachmentUrl} target="_blank" rel="noreferrer" variant="text">Open proof</Button>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save payout</Button>
      </DialogActions>
    </Dialog>
  );
}

export function CohortDetailClient({ id }: { id: string }) {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cohort, setCohort] = useState<AdminRow | null>(null);
  const [allCohorts, setAllCohorts] = useState<AdminRow[]>([]);
  const [organizations, setOrganizations] = useState<AdminRow[]>([]);
  const [allParticipants, setAllParticipants] = useState<AdminRow[]>([]);
  const [sessions, setSessions] = useState<AdminRow[]>([]);
  const [registrations, setRegistrations] = useState<AdminRow[]>([]);
  const [compareRegistrations, setCompareRegistrations] = useState<AdminRow[]>([]);
  const [participants, setParticipants] = useState<AdminRow[]>([]);
  const [communications, setCommunications] = useState<AdminRow[]>([]);
  const [templates, setTemplates] = useState<AdminRow[]>([]);
  const [payments, setPayments] = useState<AdminRow[]>([]);
  const [invoiceDrafts, setInvoiceDrafts] = useState<AdminRow[]>([]);
  const [distribution, setDistribution] = useState<AdminRow | null>(null);
  const [tasks, setTasks] = useState<AdminRow[]>([]);
  const [resources, setResources] = useState<AdminRow[]>([]);
  const [activity, setActivity] = useState<AdminRow[]>([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AdminRow | null>(null);
  const [calendarCancelTarget, setCalendarCancelTarget] = useState<{ scope: "session" | "cohort"; session?: AdminRow } | null>(null);
  const [calendarPreviewSession, setCalendarPreviewSession] = useState<AdminRow | null>(null);
  const [cancellingCalendar, setCancellingCalendar] = useState(false);
  const [cancellationNoticeOpen, setCancellationNoticeOpen] = useState(false);
  const [sendingCancellationNotice, setSendingCancellationNotice] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [resourceSeedSession, setResourceSeedSession] = useState<AdminRow | null>(null);
  const [chartMode, setChartMode] = useState<"count" | "amount">("count");
  const [compareCohortId, setCompareCohortId] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [registrationPaymentFilter, setRegistrationPaymentFilter] = useState("");
  const [registrationRosterFilter, setRegistrationRosterFilter] = useState("");
  const [registrationSelection, setRegistrationSelection] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [bulkRegistrationPaymentStatus, setBulkRegistrationPaymentStatus] = useState("");
  const [updatingBulkRegistrations, setUpdatingBulkRegistrations] = useState(false);
  const [paymentDetail, setPaymentDetail] = useState<AdminRow | null>(null);
  const [registrationDetail, setRegistrationDetail] = useState<AdminRow | null>(null);
  const [registrationRemovalAction, setRegistrationRemovalAction] = useState<{ action: "archive" | "delete"; row: AdminRow } | null>(null);
  const [registrationDialogOpen, setRegistrationDialogOpen] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<AdminRow | null>(null);
  const [registrationThread, setRegistrationThread] = useState<AdminRow[]>([]);
  const [registrationThreadLoading, setRegistrationThreadLoading] = useState(false);
  const [sendingRegistrationTaskId, setSendingRegistrationTaskId] = useState("");
  const [completingRegistrationTaskId, setCompletingRegistrationTaskId] = useState("");
  const [editingRegistrationParticipantId, setEditingRegistrationParticipantId] = useState("");
  const [registrationParticipantEdit, setRegistrationParticipantEdit] = useState({ firstName: "", lastName: "", email: "", title: "", phone: "" });
  const [savingRegistrationParticipantId, setSavingRegistrationParticipantId] = useState("");
  const [participantDetail, setParticipantDetail] = useState<AdminRow | null>(null);
  const [participantSelection, setParticipantSelection] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [bulkParticipantStatus, setBulkParticipantStatus] = useState("REGISTERED");
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogSource, setMoveDialogSource] = useState<"registrations" | "participants">("registrations");
  const [moveRegistrationIds, setMoveRegistrationIds] = useState<string[]>([]);
  const [moveTargetCohortId, setMoveTargetCohortId] = useState("");
  const [movingRegistrations, setMovingRegistrations] = useState(false);
  const [moveParticipantsDialogOpen, setMoveParticipantsDialogOpen] = useState(false);
  const [moveParticipantsTargetCohortId, setMoveParticipantsTargetCohortId] = useState("");
  const [movingParticipantsToCohort, setMovingParticipantsToCohort] = useState(false);
  const [participantMessageOpen, setParticipantMessageOpen] = useState(false);
  const [participantMessageTargets, setParticipantMessageTargets] = useState<AdminRow[]>([]);
  const [participantMessageMode, setParticipantMessageMode] = useState<"template" | "custom">("template");
  const [participantMessageTemplateId, setParticipantMessageTemplateId] = useState("");
  const [participantMessageSubject, setParticipantMessageSubject] = useState("");
  const [participantMessageBody, setParticipantMessageBody] = useState("");
  const [participantMessageLinkText, setParticipantMessageLinkText] = useState("");
  const [participantMessageLinkUrl, setParticipantMessageLinkUrl] = useState("");
  const [participantMessageActiveField, setParticipantMessageActiveField] = useState<"subject" | "bodyText">("bodyText");
  const participantMessageSelectionRef = useRef<Record<"subject" | "bodyText", { start: number; end: number }>>({
    subject: { start: 0, end: 0 },
    bodyText: { start: 0, end: 0 }
  });
  const [sendingParticipantMessage, setSendingParticipantMessage] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<AdminRow | null>(null);
  const [invoiceSeedRegistration, setInvoiceSeedRegistration] = useState<AdminRow | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<{ url: string; title: string } | null>(null);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState<AdminRow | null>(null);
  const [distributionSettings, setDistributionSettings] = useState({
    commissionPercent: "30",
    tlSharePercent: "70",
    tlName: "",
    quickBooksVendorRef: "",
    quickBooksExpenseAccountRef: "",
    notes: ""
  });
  const [quickBooksRefs, setQuickBooksRefs] = useState<{ vendors: AdminRow[]; accounts: AdminRow[]; environment?: string; realmId?: string }>({ vendors: [], accounts: [] });
  const [loadingQuickBooksRefs, setLoadingQuickBooksRefs] = useState(false);
  const [financeHealth, setFinanceHealth] = useState<FinanceHealth | null>(null);
  const [creatingSessionEmails, setCreatingSessionEmails] = useState(false);
  const [publishingCohort, setPublishingCohort] = useState(false);
  const [movingCohortToDraft, setMovingCohortToDraft] = useState(false);
  const [applyingSessionChanges, setApplyingSessionChanges] = useState(false);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohortData, cohortRows, organizationRows, sessionRows, registrationRows, participantRows, allParticipantRows, communicationRows, templateRows, paymentRows, invoiceRows, distributionData, taskRows, resourceRows, activityRows] =
      await Promise.all([
        adminApi<AdminRow>(`/api/cohorts/${id}`),
        adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
        adminApi<AdminRow[]>("/api/organizations").catch(() => []),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/sessions`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/registrations`),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/participants`),
        adminApi<AdminRow[]>("/api/participants").catch(() => []),
        adminApi<AdminRow[]>(`/api/communications?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>("/api/communications/templates").catch(() => []),
        adminApi<AdminRow[]>("/api/payments").catch(() => []),
        adminApi<AdminRow[]>(`/api/invoices?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow>(`/api/distributions?cohortId=${id}`).catch(() => null),
        adminApi<AdminRow[]>(`/api/cohorts/${id}/tasks`).catch(() => []),
        adminApi<AdminRow[]>(`/api/resources?cohortId=${id}`).catch(() => []),
        adminApi<AdminRow[]>(`/api/audit?entityType=Cohort&entityId=${id}`).catch(() => [])
      ]);

    setCohort(cohortData);
    setAllCohorts(cohortRows);
    setOrganizations(organizationRows);
    setSessions(sessionRows);
    setRegistrations(registrationRows);
    setParticipants(participantRows);
    setAllParticipants(allParticipantRows);
    setCommunications(communicationRows);
    setTemplates(templateRows);
    setPayments(paymentRows.filter((payment) => payment.cohortId === id));
    setInvoiceDrafts(invoiceRows);
    setDistribution(distributionData);
    setTasks(taskRows);
    setResources(resourceRows);
    setActivity(activityRows);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((error) => {
      notifyError(error.message);
      setLoading(false);
    });
  }, [id, notifyError]);

  async function openRegistrationDetail(row: AdminRow) {
    setRegistrationDetail(row);
    setEditingRegistrationParticipantId("");
    setRegistrationParticipantEdit({ firstName: "", lastName: "", email: "", title: "", phone: "" });

    try {
      setRegistrationDetail(await adminApi<AdminRow>(`/api/registrations?id=${row.id}`));
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  function openRegistrationEditor(row?: AdminRow | null) {
    setEditingRegistration(row ?? null);
    setRegistrationDialogOpen(true);
  }

  async function sendRegistrationTaskMessage(task: AdminRow) {
    const registrationId = registrationDetail?.id ?? task.registrationId ?? task.registration?.id;

    if (!registrationId) {
      notifyError("This follow-up is not linked to a registration POC.");
      return;
    }

    const templateName = taskTemplateName(task);
    const template = templates.find((item) => item.active && item.name === templateName) ?? templates.find((item) => item.active && item.type === "FOLLOW_UP");

    if (!template?.id) {
      notifyError("No active pre-made template is available for this follow-up.");
      return;
    }

    setSendingRegistrationTaskId(task.id);

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToRegistrations", templateId: template.id, registrationIds: [registrationId] }
      });
      notifySuccess(`Sent ${template.name} to ${formatProperDisplay(registrationDetail?.primaryContactName ?? "the POC")}.`);
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setSendingRegistrationTaskId("");
    }
  }

  async function completeRegistrationTask(task: AdminRow) {
    setCompletingRegistrationTaskId(task.id);

    try {
      await adminApi("/api/operations/tasks", { method: "PATCH", body: { id: task.id, action: "complete" } });
      notifySuccess("Follow-up marked complete.");
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setCompletingRegistrationTaskId("");
    }
  }

  async function importRegistrationRoster(participants: ParsedRosterParticipant[]) {
    if (!registrationDetail?.id) {
      return;
    }

    try {
      for (const row of participants) {
        await adminApi("/api/participants", {
          method: "POST",
          body: {
            ...row,
            registrationId: registrationDetail.id,
            cohortId: registrationDetail.cohortId,
            organizationId: registrationDetail.organizationId,
            deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status))
          }
        });
      }

      const projectedCount = (registrationDetail.participants?.length ?? 0) + participants.length;
      if (projectedCount > Number(registrationDetail.participantCount ?? 0)) {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: {
            id: registrationDetail.id,
            participantCount: projectedCount,
            deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status))
          }
        });
      }

      notifySuccess(`${participants.length} participant${participants.length === 1 ? "" : "s"} imported.`);
      await openRegistrationDetail(registrationDetail);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function addRegistrationPocToRoster() {
    if (!registrationDetail?.id || !registrationDetail.primaryContactEmail) {
      notifyError("This registration needs a POC email before the POC can join the roster.");
      return;
    }

    const name = splitContactName(registrationDetail.primaryContactName);
    try {
      await adminApi("/api/participants", {
        method: "POST",
        body: {
          ...name,
          email: registrationDetail.primaryContactEmail,
          phone: registrationDetail.primaryContactPhone ?? "",
          title: registrationDetail.primaryContactTitle ?? "",
          registrationId: registrationDetail.id,
          cohortId: registrationDetail.cohortId,
          organizationId: registrationDetail.organizationId,
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status))
        }
      });
      notifySuccess("POC added to the participant roster.");
      await openRegistrationDetail(registrationDetail);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function removeRegistrationParticipant(participantId: string) {
    if (!registrationDetail?.id) {
      return;
    }
    try {
      const defer = ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status));
      await adminApi(`/api/participants?id=${participantId}${defer ? "&deferNotifications=1" : ""}`, { method: "DELETE" });
      notifySuccess("Participant removed from the roster.");
      await openRegistrationDetail(registrationDetail);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  function startRegistrationParticipantEdit(participant: AdminRow) {
    setEditingRegistrationParticipantId(participant.id);
    setRegistrationParticipantEdit({
      firstName: String(participant.firstName ?? ""),
      lastName: String(participant.lastName ?? ""),
      email: String(participant.email ?? ""),
      title: String(participant.title ?? ""),
      phone: String(participant.phone ?? "")
    });
  }

  async function saveRegistrationParticipantEdit(participant: AdminRow) {
    if (!registrationParticipantEdit.firstName.trim() || !registrationParticipantEdit.lastName.trim() || !registrationParticipantEdit.email.trim()) {
      notifyError("Participant first name, last name, and email are required.");
      return;
    }

    setSavingRegistrationParticipantId(participant.id);

    try {
      await adminApi("/api/participants", {
        method: "PATCH",
        body: {
          id: participant.id,
          firstName: registrationParticipantEdit.firstName.trim(),
          lastName: registrationParticipantEdit.lastName.trim(),
          email: registrationParticipantEdit.email.trim(),
          title: registrationParticipantEdit.title.trim(),
          phone: registrationParticipantEdit.phone.trim(),
          deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status))
        }
      });
      setEditingRegistrationParticipantId("");
      setRegistrationParticipantEdit({ firstName: "", lastName: "", email: "", title: "", phone: "" });
      notifySuccess("Participant updated.");
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
      if (participantDetail?.id === participant.id) {
        setParticipantDetail((current) => current ? {
          ...current,
          firstName: registrationParticipantEdit.firstName.trim(),
          lastName: registrationParticipantEdit.lastName.trim(),
          email: registrationParticipantEdit.email.trim(),
          title: registrationParticipantEdit.title.trim(),
          phone: registrationParticipantEdit.phone.trim()
        } : current);
      }
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setSavingRegistrationParticipantId("");
    }
  }

  function startParticipantPocRepair(participant: AdminRow) {
    const registration = participant.registration;

    if (!registration?.primaryContactEmail) {
      notifyError("This participant does not have registration POC details available.");
      return;
    }

    const name = splitContactName(registration.primaryContactName ?? "");
    setEditingRegistrationParticipantId(participant.id);
    setRegistrationParticipantEdit({
      firstName: name.firstName,
      lastName: name.lastName,
      email: String(registration.primaryContactEmail ?? ""),
      title: String(registration.primaryContactTitle ?? ""),
      phone: String(registration.primaryContactPhone ?? "")
    });
  }

  useEffect(() => {
    if (!compareCohortId) {
      setCompareRegistrations([]);
      return;
    }

    adminApi<AdminRow[]>(`/api/cohorts/${compareCohortId}/registrations`)
      .then(setCompareRegistrations)
      .catch((error) => notifyError(error.message));
  }, [compareCohortId, notifyError]);

  useEffect(() => {
    if (!registrationDetail?.primaryContactEmail) {
      setRegistrationThread([]);
      return;
    }

    setRegistrationThreadLoading(true);
    adminApi<AdminRow[]>(`/api/communications/thread?email=${encodeURIComponent(registrationDetail.primaryContactEmail)}`)
      .then(setRegistrationThread)
      .catch((error) => notifyError(error.message))
      .finally(() => setRegistrationThreadLoading(false));
  }, [registrationDetail?.primaryContactEmail, notifyError]);

  useEffect(() => {
    if (!distribution?.distribution) {
      return;
    }

    setDistributionSettings({
      commissionPercent: String(distribution.distribution.commissionPercent ?? 30),
      tlSharePercent: String(distribution.distribution.tlSharePercent ?? 70),
      tlName: distribution.distribution.tlName ?? "",
      quickBooksVendorRef: distribution.distribution.quickBooksVendorRef ?? "",
      quickBooksExpenseAccountRef: distribution.distribution.quickBooksExpenseAccountRef ?? "",
      notes: distribution.distribution.notes ?? ""
    });
  }, [distribution]);

  useEffect(() => {
    adminApi<AdminRow>("/api/system-health")
      .then((health) => {
        const groups = (health.groups ?? []) as AdminRow[];
        const checks = groups.flatMap((group) => (group.checks ?? []) as AdminRow[]);
        const byKey = new Map(checks.map((check) => [String(check.key), check]));
        setFinanceHealth({
          sendgridReady: byKey.get("sendgrid")?.status === "healthy",
          storageReady: byKey.get("storageEnv")?.status === "healthy",
          privateBucketReady: byKey.get("mission-control-private")?.status === "healthy" || checks.some((check) => check.label === "Private files bucket" && check.status === "healthy"),
          checkedAt: health.generatedAt
        });
      })
      .catch(() => setFinanceHealth(null));
  }, []);

  const totals = useMemo(() => {
    const totalAmount = registrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0);
    const paidAmount = registrations.reduce((sum, registration) => sum + registrationCollectedAmount(registration, payments, invoiceDrafts), 0);
    const invoicedAmount = Math.max(totalAmount - paidAmount, 0);
    const participantSeats = registrations.reduce((sum, registration) => sum + Number(registration.participantCount ?? 0), 0);
    const rosterComplete = registrations.filter((registration) => registrationRosterStatus(registration) === "COMPLETE").length;
    const openPaymentFollowUps = tasks.filter((task) => task.status !== "COMPLETED" && task.category === "PAYMENT_FOLLOW_UP").length;
    const upcomingSessions = sessions.filter((session) => new Date(session.startTime).getTime() >= Date.now()).length;

    return { totalAmount, paidAmount, invoicedAmount, participantSeats, rosterComplete, openPaymentFollowUps, upcomingSessions };
  }, [invoiceDrafts, payments, registrations, sessions, tasks]);

  const compareCohort = allCohorts.find((item) => item.id === compareCohortId);
  const detailTabs = ["Overview", "Registrations", "Participants", "Communications", "Distribution"];
  const readinessItems = cohort?.readiness?.items ?? [];
  const sessionEmailReadiness = readinessItems.find((item: AdminRow) => item.key === "communications");
  const cohortStatus = String(cohort?.status ?? cohort?.derivedStatus ?? "");
  const showPublishAction = cohortStatus === "DRAFT";
  const canMoveBackToDraft = ["PUBLISHED", "ACTIVE"].includes(cohortStatus);
  const readinessSummaryText = cohort?.readiness?.ready
      ? cohortStatus === "DRAFT"
        ? "All systems are ready for publication."
        : "Delivery systems are ready."
      : cohortStatus === "DRAFT"
        ? "Complete these systems before this cohort can become Published."
        : "Delivery systems need attention.";
  const pendingSessionChanges = (cohort?.readiness?.sessionDetails ?? []).filter((session: AdminRow) => session.calendar?.stale);

  const filteredRegistrations = useMemo(() => registrations.filter((registration) => {
    const paymentMatch = !registrationPaymentFilter || registration.paymentStatus === registrationPaymentFilter;
    const rosterMatch = !registrationRosterFilter || registrationRosterStatus(registration) === registrationRosterFilter;
    return paymentMatch && rosterMatch;
  }).sort((a, b) => {
    const aTime = new Date(String(a.createdAt ?? 0)).getTime();
    const bTime = new Date(String(b.createdAt ?? 0)).getTime();

    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }

    return String(a.primaryContactName ?? a.organization?.name ?? "").localeCompare(String(b.primaryContactName ?? b.organization?.name ?? ""));
  }), [registrationPaymentFilter, registrationRosterFilter, registrations]);

  const selectedParticipantRows = useMemo(
    () => participants.filter((participant) => participantSelection.ids.has(participant.id)),
    [participants, participantSelection]
  );
  const participantCsvRows = selectedParticipantRows.length > 0 ? selectedParticipantRows : participants;
  const selectedRegistrationRows = useMemo(
    () => registrations.filter((registration) => registrationSelection.ids.has(registration.id)),
    [registrations, registrationSelection]
  );
  const selectedRegistrationIds = useMemo(
    () => selectedRegistrationRows.map((registration) => String(registration.id)),
    [selectedRegistrationRows]
  );
  const selectedParticipantRegistrationIds = useMemo(
    () => Array.from(new Set(selectedParticipantRows.map((participant) => String(participant.registrationId ?? "")).filter(Boolean))),
    [selectedParticipantRows]
  );
  const moveRegistrationRows = useMemo(
    () => registrations.filter((registration) => moveRegistrationIds.includes(String(registration.id))),
    [moveRegistrationIds, registrations]
  );
  const moveTargetOptions = useMemo(
    () => allCohorts.filter((row) => row.id !== id),
    [allCohorts, id]
  );

  const participantHistory = useMemo(() => {
    if (!participantDetail?.email) {
      return [];
    }

    const email = String(participantDetail.email).toLowerCase();
    return allParticipants.filter((participant) => String(participant.email ?? "").toLowerCase() === email && participant.id !== participantDetail.id);
  }, [allParticipants, participantDetail]);

  const distributionLedgerRows = useMemo(() => {
    const incoming = payments.map((payment) => ({
      id: `payment-${payment.id}`,
      kind: "payment",
      source: payment,
      date: payment.paymentDate ?? payment.createdAt,
      label: payment.organization?.name ?? payment.registration?.organization?.name ?? "Incoming payment",
      helper: `Incoming · ${formatStatusLabel(payment.status)}`,
      amount: Number(payment.amount ?? 0),
      status: payment.status
    }));
    const payouts = (distribution?.distribution?.payouts ?? []).map((payout: AdminRow) => ({
      id: `payout-${payout.id}`,
      kind: "payout",
      source: payout,
      date: payout.paymentDate ?? payout.createdAt,
      label: distribution?.distribution?.tlName ?? "TL payout",
      helper: `Outgoing · ${formatStatusLabel(payout.status)} · QB ${formatStatusLabel(payout.quickBooksSyncStatus ?? "NOT_SYNCED")}`,
      amount: -Number(payout.amount ?? 0),
      status: payout.status
    }));

    return [...incoming, ...payouts].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  }, [distribution, payments]);
  const cohortLevelMaterials = useMemo(() => resources.filter((resource) => !resource.sessionId), [resources]);
  const zoomOverview = useMemo(() => zoomLinkOverview(sessions), [sessions]);
  const prepResourceReadiness = readinessItems.find((item: AdminRow) => item.key === "prep-resources");

  function sessionEmailStatus(sessionId: string, type: string) {
    const communication = communications.find((item) => item.sessionId === sessionId && item.template?.type === type);
    return communication?.status ?? "NOT_SCHEDULED";
  }

  async function createSessionEmailSchedule(sessionId: string) {
    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "createDefaultSessionCommunications", sessionId }
      });
      notifySuccess("Default session communications created");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function createAllMissingSessionEmailSchedules() {
    setCreatingSessionEmails(true);
    try {
      const result = await adminApi<AdminRow>("/api/communications", {
        method: "PATCH",
        body: { action: "createDefaultCohortSessionCommunications", cohortId: id }
      });
      notifySuccess(`${result.created ?? 0} missing session emails created`);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setCreatingSessionEmails(false);
    }
  }

  async function applyPendingSessionChanges() {
    setApplyingSessionChanges(true);
    try {
      const result = await adminApi<AdminRow>("/api/calendar", {
        method: "POST",
        body: { action: "applyCohortChanges", cohortId: id }
      });
      const applied = Number(result.applied?.length ?? 0);
      const failed = Number(result.failed?.length ?? 0);

      if (failed > 0) {
        notifyError(`${applied} session update${applied === 1 ? "" : "s"} applied; ${failed} still need attention.`);
      } else if (result.communication?.status === "failed") {
        notifyError(`${applied} calendar update${applied === 1 ? "" : "s"} applied, but the consolidated email failed: ${result.communication.error}`);
      } else if (applied > 0) {
        notifySuccess(`${applied} session update${applied === 1 ? "" : "s"} applied with calendar notifications and one consolidated email`);
      } else {
        notifySuccess("No pending session changes");
      }
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setApplyingSessionChanges(false);
    }
  }

  async function syncGoogleCalendarSession(sessionId: string) {
    try {
      await adminApi("/api/calendar", { method: "POST", body: { sessionId, mode: "google" } });
      notifySuccess("Google Calendar invite synced");
      await load();
    } catch (error) {
      try {
        await adminApi("/api/calendar", { method: "POST", body: { sessionId, mode: "ics" } });
        notifySuccess("Google unavailable; ICS invite generated");
        await load();
      } catch {
        notifyError((error as Error).message);
      }
    }
  }

  async function publishReadyCohort() {
    setPublishingCohort(true);

    try {
      const result = await adminApi<AdminRow>(`/api/cohorts/${id}`, { method: "PATCH", body: { action: "publish" } });
      if (result.delivery?.status === "needs_attention") {
        notifyError(`Cohort published, but calendar delivery needs attention: ${result.delivery.error}`);
      } else {
        notifySuccess("Cohort published and calendar invitations released");
      }
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setPublishingCohort(false);
    }
  }

  async function moveBackToDraft() {
    setMovingCohortToDraft(true);

    try {
      const result = await adminApi<AdminRow>(`/api/cohorts/${id}`, { method: "PATCH", body: { action: "moveToDraft" } });
      const pausedCount = Number(result.pausedCommunications ?? 0);
      notifySuccess(
        `Cohort moved back to Draft. ${pausedCount} unsent email${pausedCount === 1 ? "" : "s"} paused.`
      );
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setMovingCohortToDraft(false);
    }
  }

  function sessionEmailSummary(session: AdminRow, readiness?: AdminRow) {
    if (readiness?.emails) {
      const total = Number(readiness.emails.total ?? 0);
      const scheduled = Number(readiness.emails.scheduled ?? 0);

      return {
        scheduled,
        total,
        ready: Boolean(readiness.emails.ready),
        label: String(readiness.emails.detail ?? `${scheduled}/${total} emails`)
      };
    }

    const expectedEmailTypes = sessionEmailTypesForSession(Number(session.sessionNumber ?? 0));
    const scheduled = expectedEmailTypes.filter((template) => sessionEmailStatus(session.id, template.type) !== "NOT_SCHEDULED");
    return {
      scheduled: scheduled.length,
      total: expectedEmailTypes.length,
      ready: scheduled.length === expectedEmailTypes.length,
      label: `${scheduled.length}/${expectedEmailTypes.length} emails`
    };
  }

  function openMaterialDialog(session?: AdminRow | null) {
    setResourceSeedSession(session ?? null);
    setResourceDialogOpen(true);
  }

  function participantMessageRecipients() {
    return Array.from(new Set(participantMessageTargets.map((participant) => String(participant.email ?? "").trim().toLowerCase()).filter(Boolean)));
  }

  function rememberParticipantMessageSelection(field: "subject" | "bodyText", event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const element = event.currentTarget;
    participantMessageSelectionRef.current[field] = {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length
    };
    setParticipantMessageActiveField(field);
  }

  function replaceParticipantMessageSelection(field: "subject" | "bodyText", replacement: string) {
    const currentValue = field === "subject" ? participantMessageSubject : participantMessageBody;
    const selection = participantMessageSelectionRef.current[field] ?? { start: currentValue.length, end: currentValue.length };
    const start = Math.min(selection.start, currentValue.length);
    const end = Math.min(selection.end, currentValue.length);
    const nextValue = `${currentValue.slice(0, start)}${replacement}${currentValue.slice(end)}`;

    if (field === "subject") {
      setParticipantMessageSubject(nextValue);
    } else {
      setParticipantMessageBody(nextValue);
    }

    participantMessageSelectionRef.current[field] = { start: start + replacement.length, end: start + replacement.length };
  }

  function insertParticipantMessageMergeField(field: string) {
    const token = `{{${field}}}`;
    const targetField = participantMessageActiveField;
    const currentValue = targetField === "subject" ? participantMessageSubject : participantMessageBody;
    const selection = participantMessageSelectionRef.current[targetField] ?? { start: currentValue.length, end: currentValue.length };
    const start = Math.min(selection.start, currentValue.length);
    const end = Math.min(selection.end, currentValue.length);
    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);
    const leadingSpace = before && !/\s$/.test(before) ? " " : "";
    const trailingSpace = after && !/^\s/.test(after) ? " " : "";

    replaceParticipantMessageSelection(targetField, `${leadingSpace}${token}${trailingSpace}`);
  }

  function formatParticipantMessageBody(style: "bold" | "italic" | "bullet" | "purple" | "green" | "amber" | "red") {
    const currentValue = participantMessageBody;
    const selection = participantMessageSelectionRef.current.bodyText ?? { start: currentValue.length, end: currentValue.length };
    const start = Math.min(selection.start, currentValue.length);
    const end = Math.min(selection.end, currentValue.length);
    const selected = currentValue.slice(start, end);

    if (style === "bullet") {
      const bulletText = selected
        ? selected.split("\n").map((line) => line.trim() ? `- ${line.replace(/^[-*]\s+/, "")}` : line).join("\n")
        : "- Bullet item";
      replaceParticipantMessageSelection("bodyText", bulletText);
      return;
    }

    const wrappers = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      purple: ["{purple:", "}"],
      green: ["{green:", "}"],
      amber: ["{amber:", "}"],
      red: ["{red:", "}"]
    } as const;
    const [before, after] = wrappers[style];
    replaceParticipantMessageSelection("bodyText", `${before}${selected || "text"}${after}`);
  }

  function insertParticipantMessageLink() {
    const url = participantMessageLinkUrl.trim();

    if (!url) {
      notifyError("Add a link URL first.");
      return;
    }

    const currentValue = participantMessageBody;
    const selection = participantMessageSelectionRef.current.bodyText ?? { start: currentValue.length, end: currentValue.length };
    const selected = currentValue.slice(Math.min(selection.start, currentValue.length), Math.min(selection.end, currentValue.length));
    const label = participantMessageLinkText.trim() || selected || "Link text";
    replaceParticipantMessageSelection("bodyText", `[${label}](${url})`);
    setParticipantMessageLinkText("");
    setParticipantMessageLinkUrl("");
  }

  function summarizeParticipantMessageSend(result: ParticipantMessageSendResponse | undefined, fallbackRecipientCount: number) {
    const communications = result?.communications ?? [];
    const failed = communications.filter((communication) => communication.status === "FAILED");
    const sentCount = Math.max(0, (result?.recipientCount ?? fallbackRecipientCount) - failed.length);

    if (failed.length > 0) {
      const firstError = failed.find((communication) => communication.providerError)?.providerError;
      notifyError(`${sentCount} sent, ${failed.length} failed.${firstError ? ` ${firstError}` : ""}`);
      return;
    }

    notifySuccess(`Message sent to ${result?.recipientCount ?? fallbackRecipientCount} participant${(result?.recipientCount ?? fallbackRecipientCount) === 1 ? "" : "s"}.`);
  }

  function openParticipantMessageDialog(targets: AdminRow[]) {
    const cleanedTargets = targets.filter((target) => target?.id);

    if (cleanedTargets.length === 0) {
      notifyError("Select participants first.");
      return;
    }

    setParticipantMessageTargets(cleanedTargets);
    setParticipantMessageMode("template");
    setParticipantMessageTemplateId("");
    setParticipantMessageSubject("");
    setParticipantMessageBody("");
    setParticipantMessageLinkText("");
    setParticipantMessageLinkUrl("");
    setParticipantMessageActiveField("bodyText");
    setParticipantMessageOpen(true);
  }

  async function sendSelectedParticipantMessage() {
    const recipients = participantMessageRecipients();

    if (participantMessageTargets.length === 0 || recipients.length === 0) {
      notifyError("No participant email recipients were found.");
      return;
    }

    if (participantMessageMode === "template" && !participantMessageTemplateId) {
      notifyError("Choose an email template first.");
      return;
    }

    if (participantMessageMode === "custom" && (!participantMessageSubject.trim() || !participantMessageBody.trim())) {
      notifyError("Subject and message are required.");
      return;
    }

    setSendingParticipantMessage(true);
    try {
      if (participantMessageMode === "template") {
        const result = await adminApi<ParticipantMessageSendResponse>("/api/communications", {
          method: "PATCH",
          body: {
            action: "sendManualTemplateToParticipants",
            participantIds: participantMessageTargets.map((participant) => participant.id),
            templateId: participantMessageTemplateId
          }
        });
        summarizeParticipantMessageSend(result, recipients.length);
      } else {
        const result = await adminApi<ParticipantMessageSendResponse>("/api/communications", {
          method: "PATCH",
          body: {
            action: "sendManualCustomEmail",
            participantIds: participantMessageTargets.map((participant) => participant.id),
            recipientMode: "participants",
            subject: participantMessageSubject.trim(),
            bodyText: participantMessageBody.trim()
          }
        });
        summarizeParticipantMessageSend(result, recipients.length);
      }

      setParticipantMessageOpen(false);
      setParticipantMessageTargets([]);
      setParticipantMessageTemplateId("");
      setParticipantMessageSubject("");
      setParticipantMessageBody("");
      setParticipantMessageLinkText("");
      setParticipantMessageLinkUrl("");
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setSendingParticipantMessage(false);
    }
  }

  async function bulkUpdateParticipants() {
    const ids = Array.from(participantSelection.ids).map(String);

    if (ids.length === 0) {
      notifyError("Select participants first.");
      return;
    }

    try {
      for (const participantId of ids) {
        await adminApi("/api/participants", {
          method: "PATCH",
          body: {
            id: participantId,
            status: bulkParticipantStatus,
            deferNotifications: ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status))
          }
        });
      }
      notifySuccess(`${ids.length} participants updated`);
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  function openMoveRegistrationsDialog(registrationIds: string[], source: "registrations" | "participants") {
    const ids = Array.from(new Set(registrationIds.filter(Boolean)));

    if (ids.length === 0) {
      notifyError(source === "participants" ? "Select participants first." : "Select registrations first.");
      return;
    }

    setMoveRegistrationIds(ids);
    setMoveDialogSource(source);
    setMoveTargetCohortId("");
    setMoveDialogOpen(true);
  }

  async function moveSelectedRegistrationsToCohort() {
    if (moveRegistrationIds.length === 0 || !moveTargetCohortId) {
      notifyError("Choose registrations and a target cohort first.");
      return;
    }

    setMovingRegistrations(true);
    try {
      const result = await adminApi<AdminRow>("/api/registrations", {
        method: "PATCH",
        body: {
          action: "bulkMoveCohort",
          ids: moveRegistrationIds,
          targetCohortId: moveTargetCohortId
        }
      });
      const moved = Number(result.count ?? result.summary?.movedCount ?? moveRegistrationIds.length);
      const confirmationsSent = Number(result.confirmationsSent ?? 0);
      const confirmationFailures = Number(result.confirmationFailures ?? 0);
      notifySuccess(
        `${moved} registration${moved === 1 ? "" : "s"} moved to ${result.targetCohort?.title ?? "the target cohort"}. ${confirmationsSent} participant confirmation${confirmationsSent === 1 ? "" : "s"} sent${confirmationFailures ? `; ${confirmationFailures} need attention` : ""}.`
      );
      setMoveDialogOpen(false);
      setMoveRegistrationIds([]);
      setMoveTargetCohortId("");
      setRegistrationSelection({ type: "include", ids: new Set() });
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setMovingRegistrations(false);
    }
  }

  async function moveSelectedParticipantsToCohort() {
    const participantIds = selectedParticipantRows.map((participant) => String(participant.id)).filter(Boolean);
    if (participantIds.length === 0 || !moveParticipantsTargetCohortId) {
      notifyError("Choose participants and a target cohort first.");
      return;
    }

    setMovingParticipantsToCohort(true);
    try {
      const result = await adminApi<AdminRow>("/api/participants", {
        method: "PATCH",
        body: {
          action: "bulkMoveParticipants",
          ids: participantIds,
          targetCohortId: moveParticipantsTargetCohortId
        }
      });
      const moved = Number(result.count ?? result.summary?.movedCount ?? participantIds.length);
      const confirmationsSent = Number(result.confirmationsSent ?? 0);
      const confirmationFailures = Number(result.confirmationFailures ?? 0);
      notifySuccess(
        `${moved} participant${moved === 1 ? "" : "s"} moved to ${result.targetCohort?.title ?? "the target cohort"}. ${confirmationsSent} participant confirmation${confirmationsSent === 1 ? "" : "s"} sent${confirmationFailures ? `; ${confirmationFailures} need attention` : ""}.`
      );
      setMoveParticipantsDialogOpen(false);
      setMoveParticipantsTargetCohortId("");
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setMovingParticipantsToCohort(false);
    }
  }

  async function bulkUpdateSelectedRegistrations(input: { bulkAction?: "confirm" | "cancel" | "archive" | "restore"; paymentStatus?: string }) {
    if (selectedRegistrationIds.length === 0) {
      notifyError("Select registrations first.");
      return;
    }

    if (input.paymentStatus === "") {
      notifyError("Choose a payment status first.");
      return;
    }

    setUpdatingBulkRegistrations(true);
    try {
      const result = await adminApi<AdminRow>("/api/registrations", {
        method: "PATCH",
        body: {
          action: "bulk",
          ids: selectedRegistrationIds,
          ...(input.bulkAction ? { bulkAction: input.bulkAction } : {}),
          ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {})
        }
      });
      notifySuccess(`${Number(result.count ?? selectedRegistrationIds.length)} registration${Number(result.count ?? selectedRegistrationIds.length) === 1 ? "" : "s"} updated.`);
      setRegistrationSelection({ type: "include", ids: new Set() });
      setBulkRegistrationPaymentStatus("");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setUpdatingBulkRegistrations(false);
    }
  }

  function openInvoiceEditor(invoice?: AdminRow | null, registration?: AdminRow | null) {
    setEditingInvoice(invoice ?? null);
    setInvoiceSeedRegistration(registration ?? null);
    setInvoiceDialogOpen(true);
  }

  function openInvoicePreview(url?: string | null, title = "Invoice PDF") {
    if (!url) {
      notifyError("Generate the PDF before previewing it.");
      return;
    }
    setInvoicePreview({ url, title });
  }

  async function saveDistributionSettings() {
    try {
      await adminApi("/api/distributions", {
        method: "PATCH",
        body: {
          cohortId: id,
          commissionPercent: Number(distributionSettings.commissionPercent),
          tlSharePercent: Number(distributionSettings.tlSharePercent),
          tlName: distributionSettings.tlName || undefined,
          quickBooksVendorRef: distributionSettings.quickBooksVendorRef || undefined,
          quickBooksExpenseAccountRef: distributionSettings.quickBooksExpenseAccountRef || undefined,
          notes: distributionSettings.notes || undefined
        }
      });
      notifySuccess("Distribution settings saved");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function loadQuickBooksRefs() {
    setLoadingQuickBooksRefs(true);
    try {
      const refs = await adminApi<{ vendors: AdminRow[]; accounts: AdminRow[]; environment?: string; realmId?: string }>("/api/integrations/setup?provider=QUICKBOOKS&action=listAccountingRefs");
      setQuickBooksRefs({
        vendors: refs.vendors ?? [],
        accounts: refs.accounts ?? [],
        environment: refs.environment,
        realmId: refs.realmId
      });
      notifySuccess("QuickBooks payout refs loaded");
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setLoadingQuickBooksRefs(false);
    }
  }

  async function createBatchInvoices() {
    const existingRegistrationIds = new Set(invoiceDrafts.map((invoice) => invoice.registrationId).filter(Boolean));
    const candidates = registrations.filter((registration) => (
      !registration.archivedAt &&
      !existingRegistrationIds.has(registration.id) &&
      ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(registration.paymentStatus ?? "")
    ));

    if (candidates.length === 0) {
      notifyError("No unpaid registrations are missing invoice drafts.");
      return;
    }

    try {
      await Promise.all(candidates.map((registration) => adminApi("/api/invoices", {
        method: "POST",
        body: { cohortId: id, registrationId: registration.id, organizationId: registration.organizationId }
      })));
      notifySuccess(`${candidates.length} invoice drafts created`);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function generateInvoiceDocument(invoice: AdminRow, receipt = false) {
    try {
      await adminApi("/api/invoices", { method: "PATCH", body: { action: "generatePdf", id: invoice.id, receipt } });
      notifySuccess(receipt ? "Receipt PDF generated" : "Invoice PDF generated");
      await load();
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendInvoiceDocument(invoice: AdminRow, receipt = false) {
    try {
      await adminApi("/api/invoices", { method: "PATCH", body: { action: receipt ? "sendReceipt" : "sendInvoice", id: invoice.id } });
      notifySuccess(receipt ? "Receipt sent" : "Invoice sent");
      await load();
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendRegistrationInvoicePackage(invoice: AdminRow, registrationId?: string | null) {
    const resolvedRegistrationId = registrationId ?? invoice.registrationId;

    if (!resolvedRegistrationId) {
      notifyError("This invoice is not linked to a registration.");
      return;
    }

    try {
      const result = await adminApi<AdminRow>("/api/invoices", {
        method: "PATCH",
        body: {
          action: "sendRegistrationInvoicePackage",
          id: invoice.id,
          registrationId: resolvedRegistrationId
        }
      });
      const recipients = Array.isArray(result.recipients) ? result.recipients.join(", ") : "the POC";
      notifySuccess(`Invoice package sent to ${recipients}`);
      await load();
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function syncQuickBooksProject() {
    try {
      await adminApi(`/api/cohorts/${id}`, { method: "PATCH", body: { action: "syncQuickBooksProject" } });
      notifySuccess("QuickBooks project linked");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function syncCohortCrm() {
    try {
      await adminApi(`/api/cohorts/${id}`, { method: "PATCH", body: { action: "syncCrm" } });
      notifySuccess("Cohort synced to CRM");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function reconcileQuickBooksLinks() {
    try {
      const invoiceIds = Array.from(new Set(invoiceDrafts.map((invoice) => invoice.quickBooksInvoiceRef).filter(Boolean)));
      await adminApi(`/api/cohorts/${id}`, {
        method: "PATCH",
        body: { action: "reconcileQuickBooks", invoiceIds }
      });
      notifySuccess("QuickBooks links checked");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function createQuickBooksInvoice(invoice: AdminRow) {
    try {
      await adminApi("/api/invoices", { method: "PATCH", body: { action: "createQuickBooksInvoice", id: invoice.id } });
      notifySuccess("Invoice synced to QuickBooks");
      await load();
      if (registrationDetail?.id) {
        await openRegistrationDetail(registrationDetail);
      }
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function createQuickBooksBill(payout: AdminRow) {
    try {
      await adminApi("/api/distributions", { method: "PATCH", body: { action: "createQuickBooksBill", id: payout.id } });
      notifySuccess("Payout bill created in QuickBooks");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function cancelPayout(payout: AdminRow) {
    try {
      await adminApi("/api/distributions", { method: "PATCH", body: { action: "cancelPayout", id: payout.id } });
      notifySuccess("Payout cancelled");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function updateCohortThumbnail(file?: File) {
    if (!file || !cohort) return;

    setThumbnailUploading(true);
    try {
      const uploaded = await uploadAdminFile<{ url?: string }>(file, "cohort-thumbnail");
      if (!uploaded.url) {
        throw new Error("Thumbnail upload did not return a public URL.");
      }
      await adminApi(`/api/cohorts/${id}`, { method: "PATCH", body: { thumbnailUrl: uploaded.url } });
      notifySuccess("Cohort thumbnail updated");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setThumbnailUploading(false);
    }
  }

  function renderSessionEmailCell(type: string, session: AdminRow) {
    if (!sessionEmailTypesForSession(Number(session.sessionNumber ?? 1)).some((template) => template.type === type)) {
      return <Typography variant="caption" color="text.secondary">Not used</Typography>;
    }

    const communication = communications.find((item) => item.sessionId === session.id && item.template?.type === type);
    const scheduled = Boolean(communication);
    return (
      <button
        type="button"
        className={`session-check ${scheduled ? "is-done" : "is-missing"}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!scheduled) void createSessionEmailSchedule(session.id);
        }}
      title={scheduled ? formatStatusLabel(communication?.status) : "Create scheduled communication"}
    >
      {scheduled ? <CheckCircleOutline /> : <CancelOutlined />}
    </button>
    );
  }

  function renderReadinessIcon(ready: boolean, title: string, onClick?: () => void) {
    return (
      <button
        type="button"
        className={`session-check session-check-icon ${ready ? "is-done" : "is-missing"}`}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        {ready ? <CheckCircleOutline /> : <CancelOutlined />}
      </button>
    );
  }

  const sessionColumns: GridColDef[] = [
    { field: "sessionNumber", headerName: "#", width: 80 },
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "startTime", headerName: "Start", width: 180, valueFormatter: (value, row) => formatDateTimeInZone(value, row?.timezone) },
    { field: "endTime", headerName: "End", width: 180, valueFormatter: (value, row) => formatDateTimeInZone(value, row?.timezone) },
    { field: "meetingUrl", headerName: "Meeting URL", flex: 1, minWidth: 200 },
    { field: "location", headerName: "Location", width: 180 },
    { field: "calendarInviteStatus", headerName: "Calendar", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    ...sessionEmailTypes.map((template) => ({
      field: `email-${template.type}`,
      headerName: template.label,
      width: 190,
      sortable: false,
      valueGetter: (_value: unknown, row: AdminRow) => sessionEmailStatus(row.id, template.type),
      renderCell: (params: { row: AdminRow }) => renderSessionEmailCell(template.type, params.row)
    })),
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit session", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingSession(params.row); setSessionDialogOpen(true); } },
              {
                label: "Generate ICS",
                icon: <CalendarMonthOutlined fontSize="small" />,
                onClick: async () => {
                  try {
                    await adminApi("/api/calendar", { method: "POST", body: { sessionId: params.row.id, mode: "ics" } });
                    notifySuccess("ICS invite generated");
                  } catch (error) {
                    notifyError((error as Error).message);
                  }
                }
              },
              {
                label: "Sync Google Calendar",
                icon: <CalendarMonthOutlined fontSize="small" />,
                onClick: () => void syncGoogleCalendarSession(params.row.id)
              }
            ]}
          />
        </Box>
      )
    }
  ];

  const registrationColumns: GridColDef[] = [
    { field: "primaryContactName", headerName: "Contact", flex: 1, minWidth: 160, valueGetter: (_value, row) => formatProperDisplay(row.primaryContactName ?? "") },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    {
      field: "createdAt",
      headerName: "Registered",
      width: 116,
      valueGetter: (_value, row) => row.createdAt ?? "",
      valueFormatter: (value) => formatDate(value)
    },
    {
      field: "participantCount",
      headerName: "Participants",
      width: 116,
      valueGetter: (_value, row) => Number(row.participantCount ?? 0),
      renderCell: (params) => (
        <span className="app-table-main" title={`${params.value} participant${Number(params.value ?? 0) === 1 ? "" : "s"}`}>
          {Number(params.value ?? 0).toLocaleString()}
        </span>
      )
    },
    {
      field: "totalAmount",
      headerName: "Value",
      width: 112,
      valueGetter: (_value, row) => Number(row.totalAmount ?? 0),
      valueFormatter: (value) => money(value)
    },
    {
      field: "collectedAmount",
      headerName: "Collected",
      width: 124,
      sortable: false,
      valueGetter: (_value, row) => registrationCollectedAmount(row, payments, invoiceDrafts),
      valueFormatter: (value) => money(value)
    },
    {
      field: "billingStatus",
      headerName: "Status",
      width: 132,
      sortable: false,
      valueGetter: (_value, row) => registrationBillingStatus(row, payments, invoiceDrafts),
      renderCell: (params) => <StatusChip value={params.value} />
    },
    {
      field: "participantListStatus",
      headerName: "Roster",
      width: 124,
      renderCell: (params) => <StatusChip value={registrationRosterStatus(params.row)} />
    },
    {
      field: "billing",
      headerName: "Billing",
      width: 136,
      sortable: false,
      renderCell: (params) => {
        const invoice = String(params.row.invoiceNumber ?? "").trim();
        const po = String(params.row.purchaseOrderNumber ?? "").trim();
        return (
          <div>
            <span className="app-table-main" title={invoice || "No invoice"}>{invoice || "No invoice"}</span>
            <span className="app-table-sub" title={po || "No PO"}>{po ? `PO ${po}` : "No PO"}</span>
          </div>
        );
      }
    },
    {
      field: "notes",
      headerName: "Notes",
      flex: 1,
      minWidth: 180,
      renderCell: (params) => (
        <span className="app-table-sub" title={String(params.value ?? "No notes")}>
          {params.value ? String(params.value) : "No notes"}
        </span>
      )
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 76,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Quick view", onClick: () => void openRegistrationDetail(params.row) },
              { label: "Edit registration", icon: <EditOutlined fontSize="small" />, onClick: () => openRegistrationEditor(params.row) },
              { label: "Create invoice", onClick: () => openInvoiceEditor(null, params.row) },
              { label: "Remove registration", icon: <ArchiveOutlined fontSize="small" />, onClick: () => setRegistrationRemovalAction({ action: "archive", row: params.row }) },
              { label: "Delete permanently", icon: <DeleteOutline fontSize="small" />, color: "error", onClick: () => setRegistrationRemovalAction({ action: "delete", row: params.row }) }
            ]}
          />
        </Box>
      )
    }
  ];

  const participantColumns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(`${row.firstName} ${row.lastName}`) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "status", headerName: "Status", width: 130, renderCell: (params) => <StatusChip value={params.value} /> },
    {
      field: "message",
      headerName: "Message",
      width: 118,
      sortable: false,
      renderCell: (params) => (
        <Button size="small" variant="outlined" startIcon={<SendOutlined />} onClick={(event) => { event.stopPropagation(); openParticipantMessageDialog([params.row]); }}>
          Send
        </Button>
      )
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
              { label: "Quick view", onClick: () => setParticipantDetail(params.row) },
              { label: "Edit participant", icon: <EditOutlined fontSize="small" />, onClick: () => { setParticipantDetail(params.row); startRegistrationParticipantEdit(params.row); } },
              { label: "Use registration POC", onClick: () => { setParticipantDetail(params.row); startParticipantPocRepair(params.row); } },
              { label: "Send message", icon: <SendOutlined fontSize="small" />, onClick: () => openParticipantMessageDialog([params.row]) }
            ]}
          />
        </Box>
      )
    }
  ];

  const paymentColumns: GridColDef[] = [
    { field: "organization", headerName: "Organization", flex: 1.4, minWidth: 240, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? row.registration?.organization?.name ?? "") },
    { field: "status", headerName: "Status", width: 132, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "amount", headerName: "Amount", width: 124, valueFormatter: (value) => money(value) },
    { field: "invoiceNumber", headerName: "Invoice", width: 130 },
    { field: "po", headerName: "PO", width: 110, valueGetter: (_value, row) => row.registration?.purchaseOrderNumber ?? "" },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Payment detail", onClick: () => setPaymentDetail(params.row) },
              { label: "Create invoice", onClick: () => openInvoiceEditor(null, params.row.registration ?? null) }
            ]}
          />
        </Box>
      )
    }
  ];

  const taskColumns: GridColDef[] = [
    { field: "title", headerName: "Task", flex: 1, minWidth: 220 },
    { field: "category", headerName: "Category", width: 190, valueFormatter: (value) => formatStatusLabel(String(value ?? "")) },
    { field: "priority", headerName: "Priority", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "dueDate", headerName: "Due", width: 170, valueFormatter: (value) => value ? new Date(value).toLocaleDateString("en-US") : "" },
    { field: "ownerName", headerName: "Owner", width: 160 },
    {
      field: "actions",
      headerName: "Actions",
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Button
          variant="outlined"
          color="success"
          onClick={async () => {
            try {
              await adminApi("/api/operations/tasks", { method: "PATCH", body: { id: params.row.id, action: "complete" } });
              notifySuccess("Task completed");
              await load();
            } catch (error) {
              notifyError((error as Error).message);
            }
          }}
        >
          Complete
        </Button>
      )
    }
  ];
  const resourceColumns: GridColDef[] = [
    { field: "title", headerName: "Material", flex: 1, minWidth: 220 },
    { field: "type", headerName: "Type", width: 120, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "session", headerName: "Session", width: 180, valueGetter: (_value, row) => row.session?.title ?? "Cohort" },
    { field: "visibility", headerName: "Visibility", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "muxPlaybackId", headerName: "Mux playback", width: 170 },
    { field: "url", headerName: "URL", flex: 1, minWidth: 220 }
  ];

  async function saveSession(values: AdminRow) {
    try {
      if (editingSession) {
        const result = await adminApi<AdminRow>("/api/sessions", { method: "PATCH", body: { ...values, id: editingSession.id } });
        if (result.calendarSync === "pending") {
          notifySuccess("Session change saved. Apply pending changes when all edits are ready.");
        } else {
          notifySuccess("Session updated");
        }
      } else {
        await adminApi(`/api/cohorts/${id}/sessions`, { method: "POST", body: values });
        notifySuccess("Session added");
      }
      setEditingSession(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function cancelCalendarInvites() {
    if (!calendarCancelTarget) return;
    setCancellingCalendar(true);
    try {
      const result = await adminApi<AdminRow>("/api/calendar", {
        method: "PATCH",
        body: calendarCancelTarget.scope === "session"
          ? { action: "cancelSessionInvites", sessionId: calendarCancelTarget.session?.id }
          : { action: "cancelCohortInvites", cohortId: id }
      });
      if (result.cancellationEmail?.status === "failed") {
        notifyError(`${result.googleEventsCancelled ?? 0} Google events cancelled, but the SendGrid notice failed: ${result.cancellationEmail.error}`);
      } else {
        notifySuccess(`${result.googleEventsCancelled ?? 0} Google events cancelled; custom cancellation email sent`);
      }
      setCalendarCancelTarget(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setCancellingCalendar(false);
    }
  }

  async function sendCohortCancellationNotice() {
    setSendingCancellationNotice(true);
    try {
      await adminApi("/api/calendar", {
        method: "PATCH",
        body: { action: "sendCohortCancellationNotice", cohortId: id }
      });
      notifySuccess("Cohort cancellation notice sent and recorded in Communications");
      setCancellationNoticeOpen(false);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setSendingCancellationNotice(false);
    }
  }

  async function saveTask(values: AdminRow) {
    try {
      await adminApi(`/api/cohorts/${id}/tasks`, { method: "POST", body: values });
      notifySuccess("Operations task created");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  async function saveResource(values: AdminRow) {
    try {
      await adminApi("/api/resources", {
        method: "POST",
        body: {
          ...values,
          cohortId: id,
          sessionId: values.sessionId || undefined,
          provider: values.muxPlaybackId ? "mux" : undefined
        }
      });
      notifySuccess("Material added");
      setResourceSeedSession(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
    }
  }

  return (
    <PageStack>
      <PageHeader
        title={cohort?.title ?? "Cohort Detail"}
        description="Cohort command center for readiness, delivery, registration, communication, and distribution."
      />
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
        {detailTabs.map((label) => (
          <Tab label={label} key={label} />
        ))}
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <div className="cohort-overview-grid">
            {[
              { label: "Registrations", value: registrations.length, helper: "Organizations enrolled", icon: <InsightsOutlined /> },
              { label: "Participant Seats", value: totals.participantSeats, helper: "Confirmed roster capacity", icon: <GroupsOutlined /> },
              { label: "Roster Completion", value: `${totals.rosterComplete}/${registrations.length}`, helper: "Participant lists collected", icon: <CheckCircleOutline /> },
              { label: "Upcoming Sessions", value: totals.upcomingSessions, helper: "Scheduled from today forward", icon: <CalendarMonthOutlined /> }
            ].map((metric) => (
              <article className="cohort-metric-card" key={metric.label}>
                <span className="cohort-metric-icon">{metric.icon}</span>
                <span className="cohort-metric-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <span className="cohort-metric-helper">{metric.helper}</span>
              </article>
            ))}
            <FinanceSnapshotCard
              totalAmount={totals.totalAmount}
              paidAmount={totals.paidAmount}
              projectReturn={distribution?.totals?.projectReturn}
            />
          </div>
          <div className="cohort-basics-grid">
            <SectionCard title="Overview">
              <div className="cohort-thumbnail-editor">
                <div className="cohort-thumbnail-preview">
                  {cohort?.thumbnailUrl ? <img src={cohort.thumbnailUrl} alt="" /> : <span>No thumbnail</span>}
                </div>
                <div className="quick-view-grid">
                  <DetailField label="Status" value={formatStatusLabel(cohort?.status)} />
                  <DetailField label="Presenter" value={`${cohort?.presenter?.firstName ?? ""} ${cohort?.presenter?.lastName ?? ""}`} proper />
                  <DetailField label="Session Dates" value={formatScheduleDateRange(sessions, cohort)} />
                  <DetailField label="Timezone" value={cohort?.defaultTimezone ?? "-"} />
                  <DetailField label="Slug" value={cohort?.slug ?? "-"} />
                  <DetailField label="Public Form" value={cohort?.publicRegistrationEnabled ? "Open" : "Closed"} />
                </div>
                <div className="cohort-overview-details">
                  <OverviewResourceCard label="Description" value={cohort?.description} icon={<ArticleOutlined />} />
                  <div className="cohort-overview-link-grid">
                    <OverviewResourceCard
                      label="Prep Assets"
                      value={cohort?.prepResourcesOptional ? "Optional for this cohort" : prepResourceReadiness?.ready ? "Ready" : "Needs assets"}
                      icon={prepResourceReadiness?.ready ? <CheckCircleOutline /> : <CancelOutlined />}
                      helper={prepResourceReadiness?.detail}
                    />
                    <OverviewResourceCard label="Guide Topic" value={cohort?.guideTopic} icon={<ArticleOutlined />} />
                    <OverviewResourceCard label="Guide Download" value={cohort?.guideUrl} icon={<VisibilityOutlined />} linkLabel="Open guide" />
                    <OverviewResourceCard label="Podcast YouTube" value={cohort?.podcastUrl} icon={<SendOutlined />} linkLabel="Open podcast" />
                    <OverviewResourceCard
                      label="Zoom Links"
                      value={zoomOverview.value}
                      icon={<CalendarMonthOutlined />}
                      href={zoomOverview.href}
                      linkLabel="Open first Zoom"
                      helper={zoomOverview.helper}
                    />
                  </div>
                </div>
                <div className="action-group" style={{ justifyContent: "flex-start" }}>
                  <Button component="label" variant="outlined" disabled={thumbnailUploading}>
                    {thumbnailUploading ? "Uploading" : "Upload Thumbnail"}
                    <input type="file" accept="image/*" hidden onChange={(event: any) => void updateCohortThumbnail(event.currentTarget.files?.[0])} />
                  </Button>
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title="Publish Readiness"
              action={showPublishAction ? (
                <Button
                  disabled={!cohort?.readiness?.ready || publishingCohort}
                  onClick={publishReadyCohort}
                  startIcon={<SendOutlined />}
                >
                  {publishingCohort ? "Publishing" : "Publish Cohort"}
                </Button>
              ) : canMoveBackToDraft ? (
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={movingCohortToDraft}
                  onClick={moveBackToDraft}
                >
                  {movingCohortToDraft ? "Moving" : "Move back to Draft"}
                </Button>
              ) : null}
            >
              <div className="readiness-command">
                <div className="readiness-summary">
                  <StatusChip value={cohort?.status} />
                  <span>{readinessSummaryText}</span>
                </div>
                <div className="readiness-list readiness-metric-grid">
                  {readinessItems.map((item: AdminRow) => {
                    const itemReady = Boolean(item.ready);
                    const icon =
                      item.key === "calendar" ? <CalendarMonthOutlined /> :
                          item.key === "communications" ? <EmailOutlined /> :
                          item.key === "prep-resources" ? <ArticleOutlined /> :
                          item.key === "meeting-links" ? <CalendarMonthOutlined /> :
                          item.key === "manual-tasks" ? <CheckCircleOutline /> :
                            <CheckCircleOutline />;

                    return (
                      <div className={`readiness-row readiness-metric-card ${itemReady ? "is-ready" : "needs-work"}`} key={item.key}>
                        <span className={`readiness-metric-icon ${itemReady ? "is-done" : "is-missing"}`}>
                          {itemReady ? <CheckCircleOutline /> : icon}
                        </span>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                          {item.key === "communications" && !item.ready ? (
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<SendOutlined />}
                              disabled={creatingSessionEmails || sessions.length === 0}
                              onClick={createAllMissingSessionEmailSchedules}
                            >
                              {creatingSessionEmails ? "Creating emails" : "Create missing emails"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sessionEmailReadiness && !sessionEmailReadiness.ready ? (
                  <Alert severity="warning">
                    {sessionEmailReadiness.detail}. Use Create missing emails to generate the required 24-hour and 1-hour session messages before publishing.
                  </Alert>
                ) : null}
              </div>
            </SectionCard>
          </div>
          <SectionCard
            title="Registration Evolution"
            action={
              <div className="chart-filter-row">
                <TextField select label="Metric" value={chartMode} onChange={(event) => setChartMode(event.target.value as "count" | "amount")}>
                  <MenuItem value="count">Registrants</MenuItem>
                  <MenuItem value="amount">Revenue</MenuItem>
                </TextField>
                <TextField select label="Compare" value={compareCohortId} onChange={(event) => setCompareCohortId(event.target.value)}>
                  <MenuItem value="">Current cohort only</MenuItem>
                  {allCohorts.filter((item) => item.id !== id).map((item) => (
                    <MenuItem value={item.id} key={item.id}>{item.title}</MenuItem>
                  ))}
                </TextField>
              </div>
            }
          >
            <RegistrationEvolutionChart rows={registrations} compareRows={compareRegistrations} compareLabel={compareCohort?.title} mode={chartMode} />
          </SectionCard>
          <SectionCard
            title="Sessions"
            action={
              <div className="action-group">
                {pendingSessionChanges.length > 0 && (
                  <Button
                    startIcon={<SendOutlined />}
                    disabled={applyingSessionChanges}
                    onClick={applyPendingSessionChanges}
                  >
                    {applyingSessionChanges ? "Applying" : `Apply Changes (${pendingSessionChanges.length})`}
                  </Button>
                )}
                {sessions.some((session) => (session.calendarEvents ?? []).some((event: AdminRow) => event.provider === "google")) && (
                  <Button variant="outlined" color="error" onClick={() => setCalendarCancelTarget({ scope: "cohort" })}>
                    Cancel All Invites
                  </Button>
                )}
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openMaterialDialog()}>Add Material</Button>
                <Button startIcon={<AddIcon />} onClick={() => setSessionDialogOpen(true)}>Add Session</Button>
              </div>
            }
          >
            {cohortLevelMaterials.length > 0 && (
              <div className="cohort-material-bank" aria-label="Cohort-level materials">
                <span>Cohort materials</span>
                <div>
                  {cohortLevelMaterials.map((resource) => {
                    const href = resourceHref(resource);
                    return href ? (
                      <a href={href} target="_blank" rel="noreferrer" key={resource.id} title={resource.title}>
                        {resource.title}
                      </a>
                    ) : (
                      <span key={resource.id} title={resource.title}>{resource.title}</span>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="session-checklist" role="table" aria-label="Session checklist">
              <div className="session-check-row session-check-header" role="row">
                <span>Date</span>
                <span>Session</span>
                <span>Calendar</span>
                <span>Emails</span>
                <span>Materials</span>
                <span>Actions</span>
              </div>
              {sessions.map((session) => {
                const sessionMaterials = resources.filter((resource) => resource.sessionId === session.id);
                const sessionReadiness = (cohort?.readiness?.sessionDetails ?? []).find((item: AdminRow) => item.id === session.id);
                const emailSummary = sessionEmailSummary(session, sessionReadiness);

                return (
                <div className="session-check-row" role="row" key={session.id}>
                  <DateBadge value={session.startTime} timeZone={session.timezone} />
                  <div className="session-title-cell">
                    <strong title={session.title}>{session.sessionNumber}. {session.title}</strong>
                    <span title={session.description}>
                      {formatTimeInZone(session.startTime, session.timezone) || "No time"} - {formatTimeInZone(session.endTime, session.timezone) || "No end"}
                    </span>
                    {sessionMaterials.length > 0 && (
                      <div className="session-material-links">
                        {sessionMaterials.slice(0, 3).map((resource: AdminRow) => {
                          const href = resourceHref(resource);
                          return href ? (
                            <a href={href} target="_blank" rel="noreferrer" key={resource.id} title={resource.title}>
                              {resource.title}
                            </a>
                          ) : (
                            <span key={resource.id} title={resource.title}>{resource.title}</span>
                          );
                        })}
                        {sessionMaterials.length > 3 && <span>+{sessionMaterials.length - 3}</span>}
                      </div>
                    )}
                  </div>
                  {renderReadinessIcon(Boolean(sessionReadiness?.calendar?.ready), sessionReadiness?.calendar?.detail ?? formatStatusLabel(session.calendarInviteStatus), async () => {
                    if (sessionReadiness?.calendar?.stale) {
                      await applyPendingSessionChanges();
                      return;
                    }
                    try {
                      await adminApi("/api/calendar", { method: "POST", body: { sessionId: session.id, mode: "ics" } });
                      notifySuccess("ICS invite generated");
                      await load();
                    } catch (error) {
                      notifyError((error as Error).message);
                    }
                  })}
                  <button
                    type="button"
                    className={`session-check session-email-summary ${emailSummary.ready ? "is-done" : "is-missing"}`}
                    title={emailSummary.ready ? "All default session emails exist" : "Create default session emails"}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!emailSummary.ready) void createSessionEmailSchedule(session.id);
                    }}
                  >
                    {emailSummary.ready ? <CheckCircleOutline /> : <CancelOutlined />}
                    <span>{emailSummary.label}</span>
                  </button>
                  <div className="session-material-cell">
                    <button
                      type="button"
                      className={`session-check session-material-summary ${sessionMaterials.length > 0 ? "is-done" : "is-optional"}`}
                      title={sessionMaterials.length > 0 ? `${sessionMaterials.length} material${sessionMaterials.length === 1 ? "" : "s"}` : "Add session material"}
                      onClick={(event) => {
                        event.stopPropagation();
                        openMaterialDialog(session);
                      }}
                    >
                      {sessionMaterials.length > 0 ? <CheckCircleOutline /> : <AddIcon />}
                      <span>{sessionMaterials.length || "Optional"}</span>
                    </button>
                  </div>
                  <RowActionMenu
                    actions={[
                      { label: "Edit session", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingSession(session); setSessionDialogOpen(true); } },
                      { label: "Preview Google invite", icon: <VisibilityOutlined fontSize="small" />, onClick: () => setCalendarPreviewSession(session) },
                      { label: "Add material", icon: <AddIcon fontSize="small" />, onClick: () => openMaterialDialog(session) },
                      {
                        label: "Generate ICS",
                        icon: <CalendarMonthOutlined fontSize="small" />,
                        onClick: async () => {
                          try {
                            await adminApi("/api/calendar", { method: "POST", body: { sessionId: session.id, mode: "ics" } });
                            notifySuccess("ICS invite generated");
                          } catch (error) {
                            notifyError((error as Error).message);
                          }
                        }
                      },
                      {
                        label: "Sync Google Calendar",
                        icon: <CalendarMonthOutlined fontSize="small" />,
                        onClick: () => void syncGoogleCalendarSession(session.id)
                      },
                      ...((session.calendarEvents ?? []).some((event: AdminRow) => event.provider === "google") ? [{
                        label: "Cancel Google invite",
                        icon: <CancelOutlined fontSize="small" />,
                        onClick: () => setCalendarCancelTarget({ scope: "session", session })
                      }] : [])
                    ]}
                  />
                </div>
                );
              })}
            </div>
            {!loading && sessions.length === 0 && <EmptyState title="No sessions yet" description="Add sessions to build the cohort schedule." />}
          </SectionCard>
        </Stack>
      )}

      {tab === 1 && (
        <SectionCard
          title="Registrations"
          action={
            <div className="action-group">
              <Button
                type="button"
                variant="outlined"
                startIcon={<ArrowRightLeftOutlined />}
                disabled={selectedRegistrationIds.length === 0}
                onClick={() => openMoveRegistrationsDialog(selectedRegistrationIds, "registrations")}
              >
                Move to Cohort
              </Button>
              <Button type="button" startIcon={<AddIcon />} onClick={() => openRegistrationEditor(null)}>Add Registration</Button>
            </div>
          }
        >
          <CompactFilterBar resultCount={filteredRegistrations.length}>
            <TextField select label="Payment" value={registrationPaymentFilter} onChange={(event) => setRegistrationPaymentFilter(event.target.value)}>
              <MenuItem value="">All payments</MenuItem>
              {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <TextField select label="Roster" value={registrationRosterFilter} onChange={(event) => setRegistrationRosterFilter(event.target.value)}>
              <MenuItem value="">All rosters</MenuItem>
              {rosterStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
          </CompactFilterBar>
          {selectedRegistrationIds.length > 0 && (
            <div className="participant-bulk-bar">
              <span>{selectedRegistrationIds.length} selected</span>
              <TextField select size="small" label="Payment status" value={bulkRegistrationPaymentStatus} onChange={(event) => setBulkRegistrationPaymentStatus(event.target.value)}>
                {paymentStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
              </TextField>
              <Button
                size="small"
                variant="outlined"
                disabled={!bulkRegistrationPaymentStatus || updatingBulkRegistrations}
                onClick={() => bulkUpdateSelectedRegistrations({ paymentStatus: bulkRegistrationPaymentStatus })}
              >
                Apply Payment
              </Button>
              <Button size="small" variant="outlined" disabled={updatingBulkRegistrations} onClick={() => bulkUpdateSelectedRegistrations({ bulkAction: "confirm" })}>Confirm</Button>
              <Button size="small" variant="outlined" color="warning" disabled={updatingBulkRegistrations} onClick={() => bulkUpdateSelectedRegistrations({ bulkAction: "cancel" })}>Cancel</Button>
              <Button size="small" variant="outlined" color="error" disabled={updatingBulkRegistrations} onClick={() => bulkUpdateSelectedRegistrations({ bulkAction: "archive" })}>Archive</Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowRightLeftOutlined />}
                disabled={updatingBulkRegistrations}
                onClick={() => openMoveRegistrationsDialog(selectedRegistrationIds, "registrations")}
              >
                Move to Cohort
              </Button>
            </div>
          )}
          <TableShell>
            <AppDataGrid
              rows={filteredRegistrations}
              columns={registrationColumns}
              loading={loading}
              checkboxSelection
              rowSelectionModel={registrationSelection}
              onRowSelectionModelChange={setRegistrationSelection}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              onRowClick={(params) => void openRegistrationDetail(params.row)}
            />
          </TableShell>
          {!loading && filteredRegistrations.length === 0 && <EmptyState title="No registrations found" description="Registrations for this cohort will appear here, or adjust payment and roster filters." />}
        </SectionCard>
      )}

      {tab === 2 && (
        <SectionCard
          title="Participants"
          action={
            <div className="action-group">
              <Button
                type="button"
                variant="outlined"
                startIcon={<ArrowRightLeftOutlined />}
                disabled={selectedParticipantRegistrationIds.length === 0}
                onClick={() => openMoveRegistrationsDialog(selectedParticipantRegistrationIds, "participants")}
            >
              Move Registrations
            </Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<ArrowRightLeftOutlined />}
              disabled={selectedParticipantRows.length === 0}
              onClick={() => {
                setMoveParticipantsTargetCohortId("");
                setMoveParticipantsDialogOpen(true);
              }}
            >
              Move Participants
            </Button>
            <Button
              type="button"
                variant="outlined"
                startIcon={<ArticleOutlined />}
                disabled={participantCsvRows.length === 0}
                onClick={() => exportParticipantsCsv(participantCsvRows)}
              >
                {selectedParticipantRows.length > 0 ? "Export Selected CSV" : "Export CSV"}
              </Button>
              <Button href="/participants" startIcon={<AddIcon />}>Add/Edit Participant</Button>
            </div>
          }
        >
          <div className="participant-bulk-bar">
            <span>{participantSelection.ids.size} selected</span>
            <TextField select label="Bulk status" value={bulkParticipantStatus} onChange={(event) => setBulkParticipantStatus(event.target.value)}>
              {participantStatuses.map((value) => <MenuItem value={value} key={value}>{formatStatusLabel(value)}</MenuItem>)}
            </TextField>
            <Button type="button" variant="outlined" onClick={bulkUpdateParticipants}>Apply Status</Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<SendOutlined />}
              disabled={participantSelection.ids.size === 0}
              onClick={() => openParticipantMessageDialog(participants.filter((participant) => participantSelection.ids.has(participant.id)))}
            >
              Message Selected
            </Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<ArrowRightLeftOutlined />}
              disabled={selectedParticipantRegistrationIds.length === 0}
              onClick={() => openMoveRegistrationsDialog(selectedParticipantRegistrationIds, "participants")}
            >
              Move Registrations
            </Button>
            <Button
              type="button"
              variant="outlined"
              startIcon={<ArrowRightLeftOutlined />}
              disabled={selectedParticipantRows.length === 0}
              onClick={() => {
                setMoveParticipantsTargetCohortId("");
                setMoveParticipantsDialogOpen(true);
              }}
            >
              Move Participants
            </Button>
          </div>
          <TableShell>
            <AppDataGrid
              rows={participants}
              columns={participantColumns}
              loading={loading}
              checkboxSelection
              rowSelectionModel={participantSelection}
              onRowSelectionModelChange={setParticipantSelection}
              onRowClick={(params) => setParticipantDetail(params.row)}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            />
          </TableShell>
          {!loading && participants.length === 0 && <EmptyState title="No participants yet" description="Participants attached to this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 3 && (
        <SectionCard
          title="Communications"
          action={<Button variant="outlined" color="error" onClick={() => setCancellationNoticeOpen(true)}>Send Cancellation Notice</Button>}
        >
          <List dense>
            {communications.map((communication) => (
              <ListItem key={communication.id} divider>
                <ListItemText primary={communication.subject} secondary={communication.scheduledFor ? new Date(communication.scheduledFor).toLocaleString("en-US") : "Draft"} />
                <StatusChip value={communication.status} />
              </ListItem>
            ))}
          </List>
          {!loading && communications.length === 0 && <EmptyState title="No communications yet" description="Scheduled and sent communications for this cohort will appear here." />}
        </SectionCard>
      )}

      {tab === 4 && (
        <Stack spacing={2}>
          <SectionCard title="Finance Snapshot">
            {distribution ? (
              <div className="finance-command-grid">
                <div className="finance-command-main">
                  <ProjectReturnCard distribution={distribution} />
                  <div className="distribution-grid">
                    {[
                      ["Total Sold", money(distribution.totals?.soldAmount)],
                      ["Paid In", money(distribution.totals?.paidAmount)],
                      ["RPD Commission", `${distribution.distribution?.commissionPercent ?? 30}% · ${money(distribution.totals?.commissionAmount)}`],
                      ["TL Share", `${distribution.distribution?.tlSharePercent ?? 70}% · ${money(distribution.totals?.tlShareAmount)}`],
                      ["TL Payout Due", money(distribution.totals?.tlPayoutDue)],
                      ["Paid Out", money(distribution.totals?.payoutMade)],
                      ["Pending Payout", money(distribution.totals?.pendingPayout)],
                      ["Payment Ratio", `${Math.round(Number(distribution.totals?.paymentRatio ?? 0) * 100)}%`]
                    ].map(([label, value]) => (
                      <article className="cohort-metric-card" key={label}>
                        <span className="cohort-metric-label">{label}</span>
                        <strong>{value}</strong>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="finance-settings-panel">
                  <div className="section-inline-header">
                    <div>
                      <Typography variant="subtitle2">Distribution Controls</Typography>
                      <Typography variant="body2" color="text.secondary">Invoices sync into this cohort’s QuickBooks Project under RocketPD.</Typography>
                    </div>
                    <div className="section-action-row">
                      <Button size="small" variant="outlined" onClick={() => void loadQuickBooksRefs()} disabled={loadingQuickBooksRefs}>
                        {loadingQuickBooksRefs ? "Loading..." : "Load QBO refs"}
                      </Button>
                      <Button size="small" onClick={saveDistributionSettings}>Save</Button>
                    </div>
                  </div>
                  <div className="finance-settings-grid">
                    <TextField label="RPD %" type="number" value={distributionSettings.commissionPercent} onChange={(event) => setDistributionSettings((values) => ({ ...values, commissionPercent: event.target.value }))} />
                    <TextField label="TL %" type="number" value={distributionSettings.tlSharePercent} onChange={(event) => setDistributionSettings((values) => ({ ...values, tlSharePercent: event.target.value }))} />
                    <TextField label="TL name" value={distributionSettings.tlName} onChange={(event) => setDistributionSettings((values) => ({ ...values, tlName: event.target.value }))} />
                    <TextField select label="QBO vendor" value={distributionSettings.quickBooksVendorRef} onChange={(event) => setDistributionSettings((values) => ({ ...values, quickBooksVendorRef: event.target.value }))}>
                      <MenuItem value="">Choose vendor</MenuItem>
                      {(quickBooksRefs.vendors.length > 0 ? quickBooksRefs.vendors : distributionSettings.quickBooksVendorRef ? [{ id: distributionSettings.quickBooksVendorRef, fullyQualifiedName: `Saved vendor ref ${distributionSettings.quickBooksVendorRef}` }] : []).map((vendor) => (
                        <MenuItem value={vendor.id} searchText={vendor.searchText ?? vendor.fullyQualifiedName ?? vendor.name ?? vendor.id} key={vendor.id}>{vendor.fullyQualifiedName ?? vendor.name ?? vendor.id}</MenuItem>
                      ))}
                    </TextField>
                    <TextField select label="QBO expense account" value={distributionSettings.quickBooksExpenseAccountRef} onChange={(event) => setDistributionSettings((values) => ({ ...values, quickBooksExpenseAccountRef: event.target.value }))}>
                      <MenuItem value="">Choose expense account</MenuItem>
                      {(quickBooksRefs.accounts.length > 0 ? quickBooksRefs.accounts : distributionSettings.quickBooksExpenseAccountRef ? [{ id: distributionSettings.quickBooksExpenseAccountRef, fullyQualifiedName: `Saved account ref ${distributionSettings.quickBooksExpenseAccountRef}` }] : []).map((account) => (
                        <MenuItem value={account.id} searchText={account.searchText ?? account.fullyQualifiedName ?? account.name ?? account.id} key={account.id}>{[account.fullyQualifiedName ?? account.name ?? account.id, account.type, account.subtype].filter(Boolean).join(" · ")}</MenuItem>
                      ))}
                    </TextField>
                    <TextField label="Notes" value={distributionSettings.notes} onChange={(event) => setDistributionSettings((values) => ({ ...values, notes: event.target.value }))} />
                  </div>
                  {quickBooksRefs.realmId && (
                    <Typography variant="caption" color="text.secondary">
                      Loaded from QuickBooks {quickBooksRefs.environment} company {quickBooksRefs.realmId}.
                    </Typography>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState title="Distribution unavailable" description="Distribution data will appear when this cohort can be loaded." />
            )}
          </SectionCard>
          <SectionCard
            title="Invoice / Receipt Workbench"
            action={(
              <div className="section-action-row">
                <Button variant="outlined" size="small" onClick={() => openInvoiceEditor()}>Create invoice</Button>
                <Button variant="outlined" size="small" onClick={createBatchInvoices}>Create batch invoices</Button>
              </div>
            )}
          >
            <div className="cohort-finance-strip">
              <DetailField label="Invoice Drafts" value={invoiceDrafts.length} />
              <DetailField label="With PDF" value={invoiceDrafts.filter((invoice) => invoice.pdfUrl).length} />
              <DetailField label="Receipts" value={invoiceDrafts.filter((invoice) => invoice.receiptUrl).length} />
              <DetailField label="Open Balance" value={money(invoiceDrafts.reduce((sum, invoice) => sum + Math.max(Number(invoice.totalAmount ?? 0) - Number(invoice.paidAmount ?? 0), 0), 0))} />
            </div>
            <div className="finance-readiness-strip">
              <span className={financeHealth?.storageReady && financeHealth?.privateBucketReady ? "is-ready" : "is-warning"}>
                Storage {financeHealth?.storageReady && financeHealth?.privateBucketReady ? "ready" : "needs check"}
              </span>
              <span className={financeHealth?.sendgridReady ? "is-ready" : "is-warning"}>
                SendGrid {financeHealth?.sendgridReady ? "ready" : "not configured"}
              </span>
              <span className={cohort?.quickBooksProjectRef ? "is-ready" : "is-warning"}>
                QuickBooks {cohort?.quickBooksProjectRef ? "project linked" : formatStatusLabel(cohort?.quickBooksSyncStatus ?? "NOT_SYNCED")}
              </span>
              <small>{financeHealth?.sendgridReady ? "Invoice and receipt send actions are enabled." : "PDFs can still be generated and opened; sending requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."}</small>
              <Button size="small" variant="outlined" onClick={() => void syncCohortCrm()}>Sync to CRM</Button>
              {!cohort?.quickBooksProjectRef && (
                <Button size="small" variant="outlined" onClick={() => void syncQuickBooksProject()}>Link QuickBooks Project</Button>
              )}
              {(cohort?.quickBooksProjectRef || invoiceDrafts.some((invoice) => invoice.quickBooksInvoiceRef)) && (
                <Button size="small" variant="outlined" onClick={() => void reconcileQuickBooksLinks()}>Check QuickBooks Links</Button>
              )}
            </div>
            <div className="invoice-workbench">
              {invoiceDrafts.map((invoice) => (
                <div className="invoice-workbench-row" key={invoice.id}>
                  <div className="invoice-workbench-title">
                    <strong>{invoice.invoiceNumber ?? invoice.id.slice(-8)}</strong>
                    <span>{formatProperDisplay(invoice.organization?.name ?? invoice.registration?.organization?.name ?? invoice.registration?.primaryContactName ?? "Cohort invoice")}</span>
                  </div>
                  <StatusChip value={invoice.status} />
                  <DetailField label="Total" value={money(invoice.totalAmount)} />
                  <DetailField label="Paid" value={money(invoice.paidAmount)} />
                  <DetailField label="QB" value={formatStatusLabel(invoice.quickBooksSyncStatus ?? "NOT_SYNCED")} />
                  <RowActionMenu
                    actions={[
                      { label: "Edit invoice", onClick: () => openInvoiceEditor(invoice) },
                      { label: invoice.quickBooksInvoiceRef ? "Resync QuickBooks invoice" : "Create in QuickBooks", onClick: () => void createQuickBooksInvoice(invoice) },
                      { label: invoice.pdfUrl ? "Regenerate PDF" : "Generate PDF", onClick: () => void generateInvoiceDocument(invoice) },
                      ...(invoice.pdfUrl ? [{ label: "Preview PDF", onClick: () => openInvoicePreview(invoice.pdfUrl, `Invoice ${invoice.invoiceNumber ?? ""}`.trim()) }] : []),
                      { label: financeHealth?.sendgridReady === false ? "Invoice package unavailable" : "Prepare + send invoice package", disabled: financeHealth?.sendgridReady === false || !invoice.registrationId, onClick: () => void sendRegistrationInvoicePackage(invoice) },
                      { label: financeHealth?.sendgridReady === false ? "Send invoice unavailable" : "Send invoice", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendInvoiceDocument(invoice) },
                      { label: invoice.receiptUrl ? "Regenerate receipt" : "Generate receipt", onClick: () => void generateInvoiceDocument(invoice, true) },
                      ...(invoice.receiptUrl ? [
                        { label: "Preview receipt", onClick: () => openInvoicePreview(invoice.receiptUrl, `Receipt ${invoice.invoiceNumber ?? ""}`.trim()) },
                        { label: financeHealth?.sendgridReady === false ? "Send receipt unavailable" : "Send receipt", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendInvoiceDocument(invoice, true) }
                      ] : [])
                    ]}
                  />
                </div>
              ))}
              {invoiceDrafts.length === 0 && <EmptyState title="No invoice drafts yet" description="Create one invoice or batch-create drafts for unpaid registrations." />}
            </div>
          </SectionCard>
          <SectionCard
            title="Payout Ledger"
            action={<Button variant="outlined" size="small" onClick={() => { setEditingPayout(null); setPayoutDialogOpen(true); }}>Create payout</Button>}
          >
            <div className="distribution-ledger">
              {distributionLedgerRows.map((row) => (
                <div className="distribution-ledger-row" key={row.id}>
                  <DateBadge value={row.date} />
                  <div>
                    <strong>{formatProperDisplay(row.label)}</strong>
                    <span>{row.helper}</span>
                  </div>
                  <StatusChip value={row.status} />
                  <strong className={row.amount < 0 ? "is-outgoing" : "is-incoming"}>{row.amount < 0 ? "-" : "+"}{money(Math.abs(row.amount))}</strong>
                  {row.kind === "payout" && row.source && (
                    <RowActionMenu
                      actions={[
                        { label: "Edit payout", onClick: () => { setEditingPayout(row.source); setPayoutDialogOpen(true); } },
                        { label: row.source.quickBooksBillRef ? "Resync QuickBooks bill" : "Create QuickBooks bill", onClick: () => void createQuickBooksBill(row.source) },
                        ...(row.source.attachmentUrl ? [{ label: "Open proof", onClick: () => window.open(row.source.attachmentUrl, "_blank", "noreferrer") }] : []),
                        { label: "Cancel payout", onClick: () => void cancelPayout(row.source) }
                      ]}
                    />
                  )}
                </div>
              ))}
              {distributionLedgerRows.length === 0 && <EmptyState title="No ledger activity yet" description="Incoming payments and outgoing TL payouts will appear here." />}
            </div>
          </SectionCard>
          <SectionCard title="Payment Records">
            <div className="cohort-finance-strip">
              <DetailField label="Invoice Drafts" value={invoiceDrafts.length} />
              <DetailField label="Paid" value={money(totals.paidAmount)} />
              <DetailField label="Invoiced" value={money(totals.invoicedAmount)} />
            </div>
            <TableShell>
              <AppDataGrid
                rows={payments}
                columns={paymentColumns}
                loading={loading}
                pageSizeOptions={[10, 25]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                onRowClick={(params) => setPaymentDetail(params.row)}
              />
            </TableShell>
            {!loading && payments.length === 0 && <EmptyState title="No payments yet" description="Payment records tied to this cohort will appear here." />}
          </SectionCard>
        </Stack>
      )}

      <Dialog open={moveParticipantsDialogOpen} onClose={() => !movingParticipantsToCohort && setMoveParticipantsDialogOpen(false)} fullWidth maxWidth="md" PaperProps={{ className: "move-registration-modal" }}>
        <DialogTitle>Move Selected Participants</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography color="text.secondary">
              This moves {selectedParticipantRows.length} individual participant{selectedParticipantRows.length === 1 ? "" : "s"} into a new comped registration in the target cohort. The original team registration stays in place with its payment, invoice, and QuickBooks history.
            </Typography>
            <Typography color="warning.main">
              Use Move Registrations when the whole team/order should move. Use this action only when specific people are changing cohorts.
            </Typography>
            <TextField select fullWidth label="Target cohort" value={moveParticipantsTargetCohortId} onChange={(event) => setMoveParticipantsTargetCohortId(event.target.value)}>
              {moveTargetOptions.map((targetCohort) => (
                <MenuItem value={targetCohort.id} key={targetCohort.id}>{cohortDropdownLabel(targetCohort)}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setMoveParticipantsDialogOpen(false)} disabled={movingParticipantsToCohort}>Cancel</Button>
          <Button onClick={moveSelectedParticipantsToCohort} disabled={!moveParticipantsTargetCohortId || movingParticipantsToCohort || selectedParticipantRows.length === 0}>
            {movingParticipantsToCohort ? "Moving" : "Move participants"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={moveDialogOpen} onClose={() => !movingRegistrations && setMoveDialogOpen(false)} fullWidth maxWidth="md" PaperProps={{ className: "move-registration-modal" }}>
        <DialogTitle>Move Registrations to Cohort</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography color="text.secondary">
              {moveDialogSource === "participants"
                ? `This moves ${moveRegistrationIds.length} full registration${moveRegistrationIds.length === 1 ? "" : "s"} from the selected participants. All participants in each selected registration move together.`
                : `This moves ${moveRegistrationIds.length} selected registration${moveRegistrationIds.length === 1 ? "" : "s"}.`}
              {" "}Payments, invoice drafts, and registration tasks move with each registration.
            </Typography>
            {moveRegistrationRows.some((registration) => registration.quickBooksInvoiceRef || registration.quickBooksCustomerRef || registration.quickBooksRealmId) ? (
              <Typography color="warning.main">
                One or more selected registrations has QuickBooks references. The move keeps those references for audit.
              </Typography>
            ) : null}
            <TextField select fullWidth label="Target cohort" value={moveTargetCohortId} onChange={(event) => setMoveTargetCohortId(event.target.value)}>
              {moveTargetOptions.map((targetCohort) => (
                <MenuItem value={targetCohort.id} key={targetCohort.id}>{cohortDropdownLabel(targetCohort)}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setMoveDialogOpen(false)} disabled={movingRegistrations}>Cancel</Button>
          <Button onClick={moveSelectedRegistrationsToCohort} disabled={!moveTargetCohortId || movingRegistrations || moveRegistrationIds.length === 0}>
            {movingRegistrations ? "Moving" : "Move registrations"}
          </Button>
        </DialogActions>
      </Dialog>

      <MutationDialog
        title={editingSession ? "Edit Session" : "Add Session"}
        open={sessionDialogOpen}
        fields={sessionFields}
        initialValues={editingSession ?? { timezone: cohort?.defaultTimezone ?? "America/New_York", sessionNumber: sessions.length + 1 }}
        onClose={() => { setSessionDialogOpen(false); setEditingSession(null); }}
        onSubmit={saveSession}
      />
      <Dialog open={Boolean(calendarCancelTarget)} onClose={() => !cancellingCalendar && setCalendarCancelTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {calendarCancelTarget?.scope === "session" ? "Cancel Session Invitation" : "Cancel All Cohort Invitations"}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {calendarCancelTarget?.scope === "session"
              ? `Google will remove “${calendarCancelTarget.session?.title ?? "this session"}” and email a cancellation to its attendees.`
              : "Google will remove every linked session event for this cohort and email cancellations to attendees."}
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Outbound safety mode still applies. Every attendee must be allowlisted unless live calendar sending is enabled.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setCalendarCancelTarget(null)} disabled={cancellingCalendar}>Keep Invitations</Button>
          <Button color="error" onClick={() => void cancelCalendarInvites()} disabled={cancellingCalendar}>
            {cancellingCalendar ? "Cancelling" : "Send Cancellation"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(calendarPreviewSession)} onClose={() => setCalendarPreviewSession(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Google Calendar Invite Preview</DialogTitle>
        <DialogContent>
          {calendarPreviewSession && (
            <div className="calendar-invite-preview">
              <div>
                <span>Event</span>
                <strong>{calendarPreviewSession.title}</strong>
              </div>
              <div>
                <span>Date and time</span>
                <strong>{formatDateTimeInZone(calendarPreviewSession.startTime, calendarPreviewSession.timezone)} - {formatTimeInZone(calendarPreviewSession.endTime, calendarPreviewSession.timezone)}</strong>
              </div>
              <div>
                <span>Description</span>
                <p>
                  {buildSessionCalendarDescription({
                    session: calendarPreviewSession,
                    cohort: {
                      title: cohort?.title,
                      description: cohort?.description,
                      presenterName: cohortPresenterName(cohort)
                    }
                  }) || "No calendar invite description."}
                </p>
              </div>
              <div>
                <span>Guest privacy</span>
                <p>Guests cannot see the guest list, invite others, or edit the event.</p>
              </div>
              <div>
                <span>Zoom / meeting link</span>
                {calendarPreviewSession.meetingUrl
                  ? <a href={calendarPreviewSession.meetingUrl} target="_blank" rel="noreferrer">{calendarPreviewSession.meetingUrl}</a>
                  : <p>No meeting link.</p>}
              </div>
              <div>
                <span>Location</span>
                <p>{calendarPreviewSession.location || calendarPreviewSession.meetingUrl || "No location."}</p>
              </div>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setCalendarPreviewSession(null)}>Close</Button>
          <Button onClick={() => {
            if (calendarPreviewSession) {
              setEditingSession(calendarPreviewSession);
              setSessionDialogOpen(true);
            }
            setCalendarPreviewSession(null);
          }}>Edit Session</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={cancellationNoticeOpen} onClose={() => !sendingCancellationNotice && setCancellationNoticeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Send Cohort Cancellation Notice</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            Send the editable “Cohort Cancellation” template to all active participants in this cohort. This sends email only and does not change Google Calendar.
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            SendGrid safety mode applies. Every recipient must be allowlisted unless live email sending is enabled.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setCancellationNoticeOpen(false)} disabled={sendingCancellationNotice}>Cancel</Button>
          <Button color="error" onClick={() => void sendCohortCancellationNotice()} disabled={sendingCancellationNotice}>
            {sendingCancellationNotice ? "Sending" : "Send Notice"}
          </Button>
        </DialogActions>
      </Dialog>
      <MutationDialog
        title="Add Operations Task"
        open={taskDialogOpen}
        fields={taskFields}
        initialValues={{ category: "OTHER", priority: "MEDIUM" }}
        onClose={() => setTaskDialogOpen(false)}
        onSubmit={saveTask}
      />
      <MutationDialog
        title={resourceSeedSession ? `Add Material: ${resourceSeedSession.title}` : "Add Material"}
        open={resourceDialogOpen}
        fields={resourceFieldsForSessions(sessions)}
        initialValues={{ type: "LINK", visibility: "ADMIN_ONLY", sessionId: resourceSeedSession?.id ?? "" }}
        onClose={() => { setResourceDialogOpen(false); setResourceSeedSession(null); }}
        onSubmit={saveResource}
      />
      <PaymentDetailDialog
        payment={paymentDetail}
        cohortId={id}
        templates={templates}
        open={Boolean(paymentDetail)}
        onClose={() => setPaymentDetail(null)}
        onChanged={async () => {
          notifySuccess("Payment updated");
          await load();
        }}
        onError={notifyError}
      />
      <InvoiceEditorDialog
        cohortId={id}
        invoice={editingInvoice}
        seedRegistration={invoiceSeedRegistration}
        registrations={registrations}
        open={invoiceDialogOpen}
        onClose={() => {
          setInvoiceDialogOpen(false);
          setEditingInvoice(null);
          setInvoiceSeedRegistration(null);
        }}
        onSaved={async () => {
          notifySuccess(editingInvoice ? "Invoice updated" : "Invoice created");
          await load();
          if (registrationDetail?.id) {
            await openRegistrationDetail(registrationDetail);
          }
        }}
        onError={notifyError}
      />
      <Dialog
        open={Boolean(invoicePreview)}
        onClose={() => setInvoicePreview(null)}
        maxWidth="xl"
        fullWidth
        BackdropProps={{ className: "invoice-modal-backdrop" }}
        PaperProps={{ className: "invoice-preview-modal" }}
      >
        <DialogTitle>{invoicePreview?.title ?? "Invoice PDF"}</DialogTitle>
        <DialogContent className="invoice-preview-body">
          {invoicePreview?.url ? (
            <iframe className="invoice-preview-frame" src={`${invoicePreview.url}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`} title={invoicePreview.title} />
          ) : (
            <Typography color="text.secondary">Generate the PDF before previewing it.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvoicePreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>
      <PayoutEditorDialog
        cohortId={id}
        payout={editingPayout}
        payments={payments}
        open={payoutDialogOpen}
        onClose={() => {
          setPayoutDialogOpen(false);
          setEditingPayout(null);
        }}
        onSaved={async () => {
          notifySuccess(editingPayout ? "Payout updated" : "Payout created");
          await load();
        }}
        onError={notifyError}
      />
      <QuickViewDrawer
        title="Registration Detail"
        open={Boolean(registrationDetail)}
        onClose={() => setRegistrationDetail(null)}
        className="registration-detail-drawer"
        actions={registrationDetail ? (
          <div className="section-action-row">
            <Button variant="outlined" onClick={() => openRegistrationEditor(registrationDetail)}>
              Edit Registration
            </Button>
            <Button variant="outlined" onClick={() => openInvoiceEditor(null, registrationDetail)}>
              Create Invoice
            </Button>
            {registrationDetail.primaryContactEmail && (
              <Button href={`/communications?search=${encodeURIComponent(registrationDetail.primaryContactEmail)}`} variant="outlined">
                Open Communications
              </Button>
            )}
            <Button variant="outlined" color="warning" onClick={() => setRegistrationRemovalAction({ action: "archive", row: registrationDetail })}>
              Remove Registration
            </Button>
          </div>
        ) : null}
      >
        {registrationDetail && (
          <>
            <RegistrationPendingChangesPanel
              registration={registrationDetail}
              onApplied={async (message) => {
                notifySuccess(message);
                await openRegistrationDetail(registrationDetail);
                await load();
              }}
              onError={notifyError}
            />
            <RegistrationDeliveryPreflight registration={registrationDetail} onAddPrimaryContact={addRegistrationPocToRoster} />
            <div className="quick-view-grid">
              <DetailField label="Contact" value={registrationDetail.primaryContactName} proper />
              <DetailField label="Email" value={registrationDetail.primaryContactEmail} />
              <DetailField label="Phone" value={registrationDetail.primaryContactPhone} />
              <DetailField label="Organization" value={registrationDetail.organization?.name} proper />
              <DetailField label="Participants" value={registrationDetail.participantCount} />
              <DetailField label="Value" value={money(registrationDetail.totalAmount)} />
              <DetailField label="Collected" value={money(registrationCollectedAmount(registrationDetail, payments, invoiceDrafts))} />
              <DetailField label="Status" value={registrationBillingStatus(registrationDetail, payments, invoiceDrafts)} />
              <DetailField label="Roster" value={formatStatusLabel(registrationRosterStatus(registrationDetail))} />
              <DetailField label="Invoice" value={registrationDetail.invoiceNumber} />
              <DetailField label="PO" value={registrationDetail.purchaseOrderNumber} />
              <DetailField label="UTM / Source" value={formatRegistrationSource(registrationDetail)} />
              <DetailField label="Landing Page" value={registrationDetail.landingPageUrl} />
            </div>
            <SectionCard title="Notes">
              <Typography color="text.secondary">{registrationDetail.notes ?? "No notes captured yet."}</Typography>
            </SectionCard>
            <SectionCard
              title="Invoices And Receipts"
              action={<Button variant="outlined" size="small" onClick={() => openInvoiceEditor(null, registrationDetail)}>Create invoice</Button>}
            >
              {(() => {
                const registrationInvoices = ((registrationDetail.invoiceDrafts ?? invoiceDrafts.filter((invoice) => invoice.registrationId === registrationDetail.id)) as AdminRow[]);

                if (registrationInvoices.length === 0) {
                  return <EmptyState title="No invoice drafts yet" description="Create an invoice draft from this registration, then generate or send the PDF from here." />;
                }

                return (
                  <div className="quick-view-list">
                    {registrationInvoices.map((invoice: AdminRow) => (
                      <div className="quick-view-list-row invoice-quick-row" key={invoice.id}>
                        <div>
                          <strong>{invoice.invoiceNumber ?? invoice.id.slice(-8)}</strong>
                          <span>
                            {[formatStatusLabel(invoice.status), invoice.pdfUrl ? "PDF ready" : "PDF needs generation"].join(" · ")}
                          </span>
                        </div>
                        <div className="invoice-quick-metrics">
                          <DetailField label="Total" value={money(invoice.totalAmount)} />
                          <DetailField label="Paid" value={money(invoice.paidAmount)} />
                          <DetailField label="Balance" value={money(Math.max(Number(invoice.totalAmount ?? 0) - Number(invoice.paidAmount ?? 0), 0))} />
                        </div>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end" className="invoice-quick-actions">
                          <StatusChip value={invoice.status} />
                          <RowActionMenu
                            actions={[
                              { label: "Edit invoice", onClick: () => openInvoiceEditor(invoice, registrationDetail) },
                              { label: invoice.quickBooksInvoiceRef ? "Resync QuickBooks invoice" : "Create in QuickBooks", onClick: () => void createQuickBooksInvoice(invoice) },
                              { label: invoice.pdfUrl ? "Regenerate PDF" : "Generate PDF", onClick: () => void generateInvoiceDocument(invoice) },
                              ...(invoice.pdfUrl ? [{ label: "Preview PDF", onClick: () => openInvoicePreview(invoice.pdfUrl, `Invoice ${invoice.invoiceNumber ?? ""}`.trim()) }] : []),
                              { label: financeHealth?.sendgridReady === false ? "Invoice package unavailable" : "Prepare + send invoice package", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendRegistrationInvoicePackage(invoice, registrationDetail.id) },
                              { label: financeHealth?.sendgridReady === false ? "Send invoice unavailable" : "Send invoice", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendInvoiceDocument(invoice) },
                              { label: invoice.receiptUrl ? "Regenerate receipt" : "Generate receipt", onClick: () => void generateInvoiceDocument(invoice, true) },
                              ...(invoice.receiptUrl ? [
                                { label: "Preview receipt", onClick: () => openInvoicePreview(invoice.receiptUrl, `Receipt ${invoice.invoiceNumber ?? ""}`.trim()) },
                                { label: financeHealth?.sendgridReady === false ? "Send receipt unavailable" : "Send receipt", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendInvoiceDocument(invoice, true) }
                              ] : [])
                            ]}
                          />
                        </Stack>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </SectionCard>
            <SectionCard title="Team Roster">
              {(registrationDetail.participants ?? []).length > 0 ? (
                <div className="quick-view-list" style={{ marginBottom: 12 }}>
                  {(registrationDetail.participants ?? []).map((participant: AdminRow) => {
                    const editing = editingRegistrationParticipantId === participant.id;

                    return (
                      <div className={`quick-view-list-row ${editing ? "is-editing-participant" : ""}`} key={participant.id}>
                        {editing ? (
                          <div className="participant-inline-editor">
                            <TextField label="First name" value={registrationParticipantEdit.firstName} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, firstName: event.target.value }))} />
                            <TextField label="Last name" value={registrationParticipantEdit.lastName} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, lastName: event.target.value }))} />
                            <TextField label="Email" type="email" value={registrationParticipantEdit.email} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, email: event.target.value }))} />
                            <TextField label="Title" value={registrationParticipantEdit.title} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, title: event.target.value }))} />
                            <TextField label="Phone" value={registrationParticipantEdit.phone} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, phone: event.target.value }))} />
                          </div>
                        ) : (
                          <div>
                            <strong>{formatProperDisplay(`${participant.firstName ?? ""} ${participant.lastName ?? ""}`.trim())}</strong>
                            <span>{[participant.email, participant.title].filter(Boolean).join(" · ") || "No contact details"}</span>
                          </div>
                        )}
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                          {editing ? (
                            <>
                              <Button size="small" variant="outlined" disabled={savingRegistrationParticipantId === participant.id} onClick={() => saveRegistrationParticipantEdit(participant)}>
                                {savingRegistrationParticipantId === participant.id ? "Saving" : "Save"}
                              </Button>
                              <Button size="small" variant="text" disabled={savingRegistrationParticipantId === participant.id} onClick={() => setEditingRegistrationParticipantId("")}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={() => startRegistrationParticipantEdit(participant)}>Edit</Button>
                              <Button size="small" variant="text" color="error" startIcon={<DeleteOutline />} onClick={() => removeRegistrationParticipant(participant.id)}>Remove</Button>
                            </>
                          )}
                        </Stack>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <RosterWorkbench
                registration={registrationDetail}
                existingParticipants={registrationDetail.participants ?? []}
                onImport={importRegistrationRoster}
                onAddPrimaryContact={addRegistrationPocToRoster}
                onRemoveParticipant={removeRegistrationParticipant}
              />
            </SectionCard>
            <SectionCard title="Open Follow-Ups">
              {(registrationDetail.operationsTasks ?? []).filter((task: AdminRow) => task.status !== "COMPLETED").length > 0 ? (
                <div className="quick-view-list">
                  {(registrationDetail.operationsTasks ?? [])
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
                          <Button size="small" variant="outlined" onClick={() => sendRegistrationTaskMessage(task)} disabled={Boolean(sendingRegistrationTaskId || completingRegistrationTaskId)}>
                            {sendingRegistrationTaskId === task.id ? "Sending" : "Send POC"}
                          </Button>
                          <Button size="small" variant="text" onClick={() => completeRegistrationTask(task)} disabled={Boolean(sendingRegistrationTaskId || completingRegistrationTaskId)}>
                            {completingRegistrationTaskId === task.id ? "Saving" : "Complete"}
                          </Button>
                        </Stack>
                      </div>
                    ))}
                </div>
              ) : (
                <Typography color="text.secondary">No open follow-ups for this registration.</Typography>
              )}
            </SectionCard>
            <SectionCard title="Registration Communication Journey">
              <RegistrationCommunicationJourney
                communications={registrationDetail.communications}
                pocEmail={registrationDetail.primaryContactEmail}
                onChanged={async () => {
                  if (registrationDetail?.id) {
                    setRegistrationDetail(await adminApi<AdminRow>(`/api/registrations?id=${registrationDetail.id}`));
                  }
                  await load();
                }}
              />
            </SectionCard>
            <SectionCard
              title="POC Email Summary"
              action={registrationDetail.primaryContactEmail ? (
                <Button href={`/communications?search=${encodeURIComponent(registrationDetail.primaryContactEmail)}`} variant="outlined" size="small">
                  Open in Communications
                </Button>
              ) : null}
            >
              <PocCommunicationHistory
                loading={registrationThreadLoading}
                communications={registrationThread}
                pocEmail={registrationDetail.primaryContactEmail}
              />
            </SectionCard>
          </>
        )}
      </QuickViewDrawer>
      <RegistrationEditor
        open={registrationDialogOpen}
        editing={editingRegistration}
        cohorts={cohort ? [cohort, ...allCohorts.filter((row) => row.id !== cohort.id)] : allCohorts}
        organizations={organizations}
        registrations={registrations}
        defaultCohortId={id}
        lockCohort={!editingRegistration}
        onClose={() => {
          setRegistrationDialogOpen(false);
          setEditingRegistration(null);
        }}
        onSaved={async () => {
          const defer = Boolean(editingRegistration && ["PUBLISHED", "ACTIVE"].includes(String(cohort?.derivedStatus ?? cohort?.status)));
          notifySuccess(defer ? "Registration saved. Review and apply its delivery changes." : editingRegistration ? "Registration updated" : "Registration created");
          await load();
          if (registrationDetail?.id) {
            try {
              setRegistrationDetail(await adminApi<AdminRow>(`/api/registrations?id=${registrationDetail.id}`));
            } catch {
              setRegistrationDetail(null);
            }
          }
        }}
      />
      <RegistrationRemovalDialog
        open={Boolean(registrationRemovalAction)}
        action={registrationRemovalAction?.action ?? null}
        registration={registrationRemovalAction?.row ?? null}
        templates={templates}
        onClose={() => setRegistrationRemovalAction(null)}
        onRemoved={async () => {
          if (registrationDetail?.id === registrationRemovalAction?.row.id) {
            setRegistrationDetail(null);
          }
          await load();
        }}
        onSuccess={notifySuccess}
        onError={notifyError}
      />
      <Dialog open={participantMessageOpen} onClose={() => setParticipantMessageOpen(false)} fullWidth maxWidth="xl" PaperProps={{ className: "participant-message-modal" }}>
        <DialogTitle>Send Participant Message</DialogTitle>
        <DialogContent>
          <div className="participant-message-composer">
            <div className="participant-message-form">
              <div className="participant-message-recipients">
                <span>{participantMessageRecipients().length} deduped recipient{participantMessageRecipients().length === 1 ? "" : "s"}</span>
                <strong>{participantMessageRecipients().slice(0, 8).join(", ")}{participantMessageRecipients().length > 8 ? `, +${participantMessageRecipients().length - 8} more` : ""}</strong>
              </div>
              <div className="participant-message-grid">
                <div className="participant-message-mode-control" role="group" aria-label="Message type">
                  <button
                    type="button"
                    className={participantMessageMode === "template" ? "is-selected" : ""}
                    aria-pressed={participantMessageMode === "template"}
                    onClick={() => setParticipantMessageMode("template")}
                  >
                    Saved template
                  </button>
                  <button
                    type="button"
                    className={participantMessageMode === "custom" ? "is-selected" : ""}
                    aria-pressed={participantMessageMode === "custom"}
                    onClick={() => setParticipantMessageMode("custom")}
                  >
                    Custom email
                  </button>
                </div>
                {participantMessageMode === "template" ? (
                  <TextField select fullWidth label="Email template" value={participantMessageTemplateId} onChange={(event) => setParticipantMessageTemplateId(event.target.value)}>
                    {templates.filter((template) => template.active).map((template) => (
                      <MenuItem value={template.id} key={template.id} searchText={`${template.name} ${template.type} ${template.subject ?? ""}`}>
                        {template.name} · {formatStatusLabel(template.type)}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <TextField
                    fullWidth
                    label="Subject"
                    value={participantMessageSubject}
                    onClick={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("subject", event)}
                    onFocus={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("subject", event)}
                    onKeyUp={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("subject", event)}
                    onSelect={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("subject", event)}
                    onChange={(event) => setParticipantMessageSubject(event.target.value)}
                  />
                )}
              </div>
              {participantMessageMode === "custom" ? (
                <>
                  <TextField
                    fullWidth
                    multiline
                    minRows={12}
                    label="Message"
                    value={participantMessageBody}
                    onClick={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("bodyText", event)}
                    onFocus={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("bodyText", event)}
                    onKeyUp={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("bodyText", event)}
                    onSelect={(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberParticipantMessageSelection("bodyText", event)}
                    onChange={(event) => setParticipantMessageBody(event.target.value)}
                  />
                  <div className="template-format-toolbar participant-message-toolbar" aria-label="Email body formatting tools">
                    <button type="button" onClick={() => formatParticipantMessageBody("bold")} title="Bold selected text"><strong>B</strong></button>
                    <button type="button" onClick={() => formatParticipantMessageBody("italic")} title="Italic selected text"><em>I</em></button>
                    <button type="button" onClick={() => formatParticipantMessageBody("bullet")} title="Add bullet points">List</button>
                    <button type="button" onClick={() => formatParticipantMessageBody("purple")} title="Purple emphasis" data-color="purple">Purple</button>
                    <button type="button" onClick={() => formatParticipantMessageBody("green")} title="Green emphasis" data-color="green">Green</button>
                    <button type="button" onClick={() => formatParticipantMessageBody("amber")} title="Amber emphasis" data-color="amber">Amber</button>
                    <button type="button" onClick={() => formatParticipantMessageBody("red")} title="Red emphasis" data-color="red">Red</button>
                  </div>
                  <div className="participant-message-link-row">
                    <TextField fullWidth label="Link text" value={participantMessageLinkText} onChange={(event) => setParticipantMessageLinkText(event.target.value)} />
                    <TextField fullWidth label="Link URL" value={participantMessageLinkUrl} onChange={(event) => setParticipantMessageLinkUrl(event.target.value)} />
                    <Button variant="outlined" onClick={insertParticipantMessageLink}>Insert link</Button>
                  </div>
                </>
              ) : null}
              {participantMessageMode === "template" && templates.filter((template) => template.active).length === 0 ? (
                <Typography color="error">No active templates are available.</Typography>
              ) : null}
            </div>
            {participantMessageMode === "custom" ? (
              <aside className="participant-message-side">
                <div className="participant-message-merge">
                  <span>Merge fields</span>
                  <div className="comms-field-cloud">
                    {participantMessageMergeFields.map((field) => (
                      <button className="template-merge-token" type="button" key={field} onClick={() => insertParticipantMessageMergeField(field)}>
                        {`{{${field}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="template-preview participant-message-preview">
                  <span>Preview</span>
                  <strong>{renderMergeFields(participantMessageSubject, sampleMergeContext, true).output || "Subject preview"}</strong>
                  <div className="comms-preview-frame comms-message-body-frame" dangerouslySetInnerHTML={{ __html: textToEmailHtml(renderMergeFields(participantMessageBody, sampleMergeContext, true).output || "Email body preview") }} />
                </div>
              </aside>
            ) : null}
          </div>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setParticipantMessageOpen(false)} disabled={sendingParticipantMessage}>Cancel</Button>
          <Button
            startIcon={<SendOutlined />}
            onClick={sendSelectedParticipantMessage}
            disabled={
              sendingParticipantMessage ||
              participantMessageRecipients().length === 0 ||
              (participantMessageMode === "template" ? !participantMessageTemplateId : !participantMessageSubject.trim() || !participantMessageBody.trim())
            }
          >
            {sendingParticipantMessage ? "Sending" : "Send message"}
          </Button>
        </DialogActions>
      </Dialog>
      <QuickViewDrawer
        title="Participant Detail"
        open={Boolean(participantDetail)}
        onClose={() => setParticipantDetail(null)}
        actions={participantDetail && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
            {editingRegistrationParticipantId === participantDetail.id ? (
              <>
                <Button variant="outlined" disabled={savingRegistrationParticipantId === participantDetail.id} onClick={() => saveRegistrationParticipantEdit(participantDetail)}>
                  {savingRegistrationParticipantId === participantDetail.id ? "Saving" : "Save"}
                </Button>
                <Button variant="text" disabled={savingRegistrationParticipantId === participantDetail.id} onClick={() => setEditingRegistrationParticipantId("")}>Cancel</Button>
              </>
            ) : (
              <>
                <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => startRegistrationParticipantEdit(participantDetail)}>Edit</Button>
                <Button variant="outlined" onClick={() => startParticipantPocRepair(participantDetail)}>Use POC Details</Button>
                <Button startIcon={<SendOutlined />} onClick={() => openParticipantMessageDialog([participantDetail])}>Send Message</Button>
              </>
            )}
          </Stack>
        )}
      >
        {participantDetail && (
          <>
            {editingRegistrationParticipantId === participantDetail.id ? (
              <div className="participant-inline-editor">
                <TextField label="First name" value={registrationParticipantEdit.firstName} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, firstName: event.target.value }))} />
                <TextField label="Last name" value={registrationParticipantEdit.lastName} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, lastName: event.target.value }))} />
                <TextField label="Email" type="email" value={registrationParticipantEdit.email} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, email: event.target.value }))} />
                <TextField label="Title" value={registrationParticipantEdit.title} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, title: event.target.value }))} />
                <TextField label="Phone" value={registrationParticipantEdit.phone} onChange={(event) => setRegistrationParticipantEdit((current) => ({ ...current, phone: event.target.value }))} />
              </div>
            ) : (
              <div className="quick-view-grid">
                <DetailField label="Participant" value={`${participantDetail.firstName ?? ""} ${participantDetail.lastName ?? ""}`} proper />
                <DetailField label="Email" value={participantDetail.email} />
                <DetailField label="Phone" value={participantDetail.phone} />
                <DetailField label="Title" value={participantDetail.title} />
                <DetailField label="Status" value={formatStatusLabel(participantDetail.status)} />
                <DetailField label="Certificate" value={participantDetail.certificateIssued ? "Issued" : "Not issued"} />
                <DetailField label="Organization" value={participantDetail.organization?.name} proper />
                <DetailField label="Registration POC" value={participantDetail.registration?.primaryContactName} proper />
                <DetailField label="Payment" value={formatRegistrationPaymentStatus(participantDetail.registration)} />
                <DetailField label="Amount" value={money(participantDetail.registration?.totalAmount)} />
                <DetailField label="Last Email" value={participantDetail.emailSummary?.lastEmailEvent ?? "-"} />
                <DetailField label="Last Email Sent" value={participantDetail.emailSummary?.lastEmailEventAt ? new Date(participantDetail.emailSummary.lastEmailEventAt).toLocaleString("en-US") : "-"} />
              </div>
            )}
            <SectionCard title="Participation History">
              {participantHistory.length > 0 ? (
                <div className="quick-view-list">
                  {participantHistory.map((participant) => (
                    <div className="quick-view-list-row" key={participant.id}>
                      <div>
                        <strong>{participant.cohort?.title ?? "Cohort"}</strong>
                        <span>{participant.organization?.name ?? "Organization"} · {formatStatusLabel(participant.status)}</span>
                      </div>
                      <DateBadge value={participant.createdAt} />
                    </div>
                  ))}
                </div>
              ) : (
                <Typography color="text.secondary">No other cohort history found for this email.</Typography>
              )}
            </SectionCard>
          </>
        )}
      </QuickViewDrawer>
      <Box>{snackbar}</Box>
    </PageStack>
  );
}
