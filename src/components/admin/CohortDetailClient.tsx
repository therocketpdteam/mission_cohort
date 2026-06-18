"use client";

import { AddIcon } from "@/components/ui/icons";
import { CalendarMonthOutlined, EmailOutlined, GroupsOutlined, InsightsOutlined } from "@/components/ui/icons";
import { CancelOutlined, CheckCircleOutline, SendOutlined } from "@/components/ui/icons";
import { EditOutlined } from "@/components/ui/icons";
import {
  Box,
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
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { adminApi, uploadAdminFile } from "@/lib/adminApi";
import { formatProperDisplay, formatStatusLabel } from "@/lib/formatting";
import { formatDateTimeInZone, formatTimeInZone } from "@/lib/timezones";
import { RosterWorkbench } from "./RosterWorkbench";
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
  useNotifier
} from "./common";

const sessionFields: FieldConfig[] = [
  { name: "title", label: "Session title", required: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "sessionNumber", label: "Session number", type: "number", required: true },
  { name: "startTime", label: "Start time", type: "datetime-local", required: true },
  { name: "endTime", label: "End time", type: "datetime-local", required: true },
  { name: "timezone", label: "Timezone", required: true },
  { name: "meetingUrl", label: "Meeting URL" },
  { name: "location", label: "Location" }
];

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
  { type: "REGISTRATION_CONFIRMATION", label: "Registration Confirmation" },
  { type: "WEEK_BEFORE_REMINDER", label: "1 Week" },
  { type: "DAY_BEFORE_REMINDER", label: "24h" },
  { type: "HOUR_BEFORE_REMINDER", label: "60m" },
  { type: "FOLLOW_UP", label: "24h Post" }
];

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

function dateInputValue(value: unknown) {
  return value ? new Date(value as string | Date).toISOString().slice(0, 10) : "";
}

function numericInputValue(value: unknown) {
  return Number(value ?? 0);
}

function communicationIssueLabel(communication: AdminRow) {
  const summary = communication.emailSummary ?? {};
  if (Number(summary.unreviewedIssueCount ?? 0) > 0) {
    return "Open issue";
  }
  if (Number(summary.reviewedIssueCount ?? 0) > 0) {
    return "Reviewed issue";
  }
  return null;
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

function registrationTrendPoints(rows: AdminRow[], mode: "count" | "amount") {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let cumulative = 0;
  return sorted.map((registration) => {
    cumulative += mode === "count" ? Number(registration.participantCount ?? 0) : Number(registration.totalAmount ?? 0);
    return { label: new Date(registration.createdAt).toLocaleDateString("en-US"), value: cumulative };
  });
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
  const max = Math.max(...points.map((point) => point.value), ...comparisonPoints.map((point) => point.value), 1);
  const width = 720;
  const height = 180;
  const innerWidth = width - 64;
  const innerHeight = height - 48;

  function pathFor(nextPoints: Array<{ label: string; value: number }>) {
    return nextPoints.map((point, index) => {
      const x = 40 + (nextPoints.length <= 1 ? innerWidth : (index / (nextPoints.length - 1)) * innerWidth);
      const y = 16 + innerHeight - (point.value / max) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  }

  if (points.length === 0) {
    return <EmptyState title="No registration trend yet" description="Registrations will draw the cohort evolution chart here." />;
  }

  return (
    <div className="cohort-evolution-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Registration evolution chart">
        <line x1="40" y1={height - 32} x2={width - 24} y2={height - 32} stroke="var(--color-slate-200)" />
        <line x1="40" y1="16" x2="40" y2={height - 32} stroke="var(--color-slate-200)" />
        {comparisonPoints.length > 0 && <path d={pathFor(comparisonPoints)} fill="none" stroke="var(--color-slate-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 8" />}
        <path d={pathFor(points)} fill="none" stroke="var(--color-blue-600)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = 40 + (points.length <= 1 ? innerWidth : (index / (points.length - 1)) * innerWidth);
          const y = 16 + innerHeight - (point.value / max) * innerHeight;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="2.8" fill="var(--color-orange-500)" />;
        })}
        <text x="40" y="14" fill="var(--color-slate-500)" fontSize="12">{mode === "count" ? `${max} seats` : money(max)}</text>
        <text x="40" y={height - 8} fill="var(--color-slate-500)" fontSize="12">{points[0]?.label}</text>
        <text x={width - 150} y={height - 8} fill="var(--color-slate-500)" fontSize="12">{points.at(-1)?.label}</text>
      </svg>
      {comparisonPoints.length > 0 && <span>Comparing against {compareLabel}</span>}
    </div>
  );
}

function FinanceSnapshotCard({
  totalAmount,
  paidAmount,
  pendingAmount,
  projectReturn
}: {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  projectReturn?: number;
}) {
  const openAmount = Math.max(totalAmount - paidAmount - pendingAmount, 0);
  const collectedPercent = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;
  const pendingPercent = totalAmount > 0 ? Math.round((pendingAmount / totalAmount) * 100) : 0;
  const openPercent = Math.max(0, 100 - collectedPercent - pendingPercent);

  return (
    <article
      className="cohort-finance-wow-card"
      style={{
        "--paid": `${collectedPercent}%`,
        "--pending": `${collectedPercent + pendingPercent}%`
      } as CSSProperties}
    >
      <div className="finance-wow-copy">
        <span className="cohort-metric-label">Revenue Snapshot</span>
        <strong>{money(totalAmount)}</strong>
        <p>
          {collectedPercent}% collected
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
        <span className="is-open" />
      </div>
      <div className="finance-wow-values">
        <DetailField label="Paid" value={money(paidAmount)} />
        <DetailField label="Pending" value={money(pendingAmount)} />
        <DetailField label="Open" value={money(openAmount)} />
        <DetailField label="Open %" value={`${openPercent}%`} />
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
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<AdminRow | null>(null);

  useEffect(() => {
    if (payment) {
      setStatus(payment.status ?? "PENDING");
      setInvoiceNumber(payment.invoiceNumber ?? payment.registration?.invoiceNumber ?? "");
      setPurchaseOrderNumber(payment.registration?.purchaseOrderNumber ?? "");
      setInvoiceUrl(payment.registration?.invoiceUrl ?? "");
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
          body: { id: payment.registrationId, paymentStatus: status, invoiceNumber, purchaseOrderNumber, invoiceUrl }
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
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth label="Invoice URL" value={invoiceUrl} onChange={(event) => setInvoiceUrl(event.target.value)} />
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
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{invoice ? "Edit Invoice Draft" : "Create Invoice"}</DialogTitle>
      <DialogContent>
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
          <TextField fullWidth label="QuickBooks customer ref" value={quickBooksCustomerRef} onChange={(event) => setQuickBooksCustomerRef(event.target.value)} />
          <TextField fullWidth label="QuickBooks invoice ref" value={quickBooksInvoiceRef} onChange={(event) => setQuickBooksInvoiceRef(event.target.value)} />
          <TextField fullWidth label="QuickBooks realm" value={quickBooksRealmId} onChange={(event) => setQuickBooksRealmId(event.target.value)} />
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
        <TextField fullWidth multiline minRows={3} label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </DialogContent>
      <DialogActions>
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
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [resourceSeedSession, setResourceSeedSession] = useState<AdminRow | null>(null);
  const [chartMode, setChartMode] = useState<"count" | "amount">("count");
  const [compareCohortId, setCompareCohortId] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [registrationPaymentFilter, setRegistrationPaymentFilter] = useState("");
  const [registrationRosterFilter, setRegistrationRosterFilter] = useState("");
  const [paymentDetail, setPaymentDetail] = useState<AdminRow | null>(null);
  const [registrationDetail, setRegistrationDetail] = useState<AdminRow | null>(null);
  const [registrationThread, setRegistrationThread] = useState<AdminRow[]>([]);
  const [registrationThreadLoading, setRegistrationThreadLoading] = useState(false);
  const [sendingRegistrationTaskId, setSendingRegistrationTaskId] = useState("");
  const [completingRegistrationTaskId, setCompletingRegistrationTaskId] = useState("");
  const [participantDetail, setParticipantDetail] = useState<AdminRow | null>(null);
  const [participantSelection, setParticipantSelection] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [bulkParticipantStatus, setBulkParticipantStatus] = useState("REGISTERED");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<AdminRow | null>(null);
  const [invoiceSeedRegistration, setInvoiceSeedRegistration] = useState<AdminRow | null>(null);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState<AdminRow | null>(null);
  const [distributionSettings, setDistributionSettings] = useState({ commissionPercent: "30", tlSharePercent: "70", tlName: "", notes: "" });
  const [financeHealth, setFinanceHealth] = useState<FinanceHealth | null>(null);
  const [calendarProvider, setCalendarProvider] = useState<"ics" | "google">("ics");
  const [preparingInvites, setPreparingInvites] = useState(false);
  const [creatingSessionEmails, setCreatingSessionEmails] = useState(false);
  const [publishingCohort, setPublishingCohort] = useState(false);
  const { notifySuccess, notifyError, snackbar } = useNotifier();

  async function load() {
    const [cohortData, cohortRows, sessionRows, registrationRows, participantRows, allParticipantRows, communicationRows, templateRows, paymentRows, invoiceRows, distributionData, taskRows, resourceRows, activityRows] =
      await Promise.all([
        adminApi<AdminRow>(`/api/cohorts/${id}`),
        adminApi<AdminRow[]>("/api/cohorts").catch(() => []),
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

    try {
      setRegistrationDetail(await adminApi<AdminRow>(`/api/registrations?id=${row.id}`));
    } catch (error) {
      notifyError((error as Error).message);
    }
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
      await Promise.all(participants.map((row) => adminApi("/api/participants", {
        method: "POST",
        body: {
          ...row,
          registrationId: registrationDetail.id,
          cohortId: registrationDetail.cohortId,
          organizationId: registrationDetail.organizationId
        }
      })));

      const projectedCount = (registrationDetail.participants?.length ?? 0) + participants.length;
      if (projectedCount > Number(registrationDetail.participantCount ?? 0)) {
        await adminApi("/api/registrations", {
          method: "PATCH",
          body: { id: registrationDetail.id, participantCount: projectedCount }
        });
      }

      notifySuccess(`${participants.length} participant${participants.length === 1 ? "" : "s"} imported.`);
      await openRegistrationDetail(registrationDetail);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
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
    const paidAmount = payments
      .filter((payment) => payment.status === "PAID")
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
    const pendingAmount = payments
      .filter((payment) => ["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
    const participantSeats = registrations.reduce((sum, registration) => sum + Number(registration.participantCount ?? 0), 0);
    const rosterComplete = registrations.filter((registration) => registration.participantListStatus === "COMPLETE").length;
    const openPaymentFollowUps = tasks.filter((task) => task.status !== "COMPLETED" && task.category === "PAYMENT_FOLLOW_UP").length;
    const upcomingSessions = sessions.filter((session) => new Date(session.startTime).getTime() >= Date.now()).length;

    return { totalAmount, paidAmount, pendingAmount, participantSeats, rosterComplete, openPaymentFollowUps, upcomingSessions };
  }, [registrations, payments, sessions, tasks]);

  const compareCohort = allCohorts.find((item) => item.id === compareCohortId);
  const detailTabs = ["Overview", "Registrations", "Participants", "Communications", "Distribution"];
  const readinessItems = cohort?.readiness?.items ?? [];
  const filteredRegistrations = useMemo(() => registrations.filter((registration) => {
    const paymentMatch = !registrationPaymentFilter || registration.paymentStatus === registrationPaymentFilter;
    const rosterMatch = !registrationRosterFilter || registration.participantListStatus === registrationRosterFilter;
    return paymentMatch && rosterMatch;
  }), [registrationPaymentFilter, registrationRosterFilter, registrations]);

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
      helper: `Outgoing · ${formatStatusLabel(payout.status)}`,
      amount: -Number(payout.amount ?? 0),
      status: payout.status
    }));

    return [...incoming, ...payouts].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  }, [distribution, payments]);
  const cohortLevelMaterials = useMemo(() => resources.filter((resource) => !resource.sessionId), [resources]);

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

  async function prepareAllCalendarInvites() {
    setPreparingInvites(true);
    try {
      const result = await adminApi<AdminRow>("/api/calendar", {
        method: "POST",
        body: {
          action: "prepareCohortInvites",
          cohortId: id,
          mode: calendarProvider,
          fallbackToIcs: true
        }
      });
      const fallbackCount = (result.results ?? []).filter((row: AdminRow) => row.fallbackReason).length;
      notifySuccess(
        fallbackCount > 0
          ? `${result.created ?? 0}/${result.total ?? 0} invites prepared; ${fallbackCount} used ICS fallback`
          : `${result.created ?? 0}/${result.total ?? 0} calendar invites prepared`
      );
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setPreparingInvites(false);
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
      await adminApi(`/api/cohorts/${id}`, { method: "PATCH", body: { action: "publish" } });
      notifySuccess("Cohort published");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setPublishingCohort(false);
    }
  }

  function sessionEmailSummary(sessionId: string) {
    const scheduled = sessionEmailTypes.filter((template) => sessionEmailStatus(sessionId, template.type) !== "NOT_SCHEDULED");
    return {
      scheduled: scheduled.length,
      total: sessionEmailTypes.length,
      ready: scheduled.length === sessionEmailTypes.length,
      label: `${scheduled.length}/${sessionEmailTypes.length} emails`
    };
  }

  function openMaterialDialog(session?: AdminRow | null) {
    setResourceSeedSession(session ?? null);
    setResourceDialogOpen(true);
  }

  async function sendParticipantMessage(participant: AdminRow) {
    const template = templates.find((item) => item.active && item.type === "FOLLOW_UP") ?? templates.find((item) => item.active);

    if (!template) {
      notifyError("No active communication template is available.");
      return;
    }

    try {
      await adminApi("/api/communications", {
        method: "PATCH",
        body: { action: "sendTemplateToParticipant", participantId: participant.id, templateId: template.id }
      });
      notifySuccess(`Message sent to ${formatProperDisplay(`${participant.firstName} ${participant.lastName}`)}`);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function bulkUpdateParticipants() {
    const ids = Array.from(participantSelection.ids).map(String);

    if (ids.length === 0) {
      notifyError("Select participants first.");
      return;
    }

    try {
      await Promise.all(ids.map((participantId) => adminApi("/api/participants", { method: "PATCH", body: { id: participantId, status: bulkParticipantStatus } })));
      notifySuccess(`${ids.length} participants updated`);
      setParticipantSelection({ type: "include", ids: new Set() });
      await load();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  function openInvoiceEditor(invoice?: AdminRow | null, registration?: AdminRow | null) {
    setEditingInvoice(invoice ?? null);
    setInvoiceSeedRegistration(registration ?? null);
    setInvoiceDialogOpen(true);
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
          notes: distributionSettings.notes || undefined
        }
      });
      notifySuccess("Distribution settings saved");
      await load();
    } catch (error) {
      notifyError((error as Error).message);
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
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  async function sendInvoiceDocument(invoice: AdminRow, receipt = false) {
    try {
      await adminApi("/api/invoices", { method: "PATCH", body: { action: receipt ? "sendReceipt" : "sendInvoice", id: invoice.id } });
      notifySuccess(receipt ? "Receipt sent" : "Invoice sent");
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

  function renderSessionEmailCell(type: string, sessionId: string) {
    const communication = communications.find((item) => item.sessionId === sessionId && item.template?.type === type);
    const scheduled = Boolean(communication);
    return (
      <button
        type="button"
        className={`session-check ${scheduled ? "is-done" : "is-missing"}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!scheduled) void createSessionEmailSchedule(sessionId);
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
      renderCell: (params: { row: AdminRow }) => renderSessionEmailCell(template.type, params.row.id)
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
    { field: "primaryContactName", headerName: "Contact", flex: 1, minWidth: 180, valueGetter: (_value, row) => formatProperDisplay(row.primaryContactName ?? "") },
    { field: "organization", headerName: "Organization", flex: 1, minWidth: 200, valueGetter: (_value, row) => formatProperDisplay(row.organization?.name ?? "") },
    { field: "participantCount", headerName: "Participants", width: 120 },
    { field: "participantListStatus", headerName: "Roster", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "paymentStatus", headerName: "Payment", width: 150, renderCell: (params) => <StatusChip value={params.value} /> },
    { field: "invoiceNumber", headerName: "Invoice", width: 130 },
    { field: "purchaseOrderNumber", headerName: "PO", width: 120 },
    {
      field: "actions",
      headerName: "Actions",
      width: 84,
      sortable: false,
      renderCell: (params) => (
        <Box onClick={(event) => event.stopPropagation()}>
          <RowActionMenu actions={[{ label: "Quick view", onClick: () => void openRegistrationDetail(params.row) }]} />
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
        <Button size="small" variant="outlined" startIcon={<SendOutlined />} onClick={(event) => { event.stopPropagation(); void sendParticipantMessage(params.row); }}>
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
              { label: "Send message", icon: <SendOutlined fontSize="small" />, onClick: () => void sendParticipantMessage(params.row) }
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
        await adminApi("/api/sessions", { method: "PATCH", body: { ...values, id: editingSession.id } });
      } else {
        await adminApi(`/api/cohorts/${id}/sessions`, { method: "POST", body: values });
      }
      notifySuccess(editingSession ? "Session updated" : "Session added");
      setEditingSession(null);
      await load();
    } catch (error) {
      notifyError((error as Error).message);
      throw error;
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
              pendingAmount={totals.pendingAmount}
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
                  <DetailField label="Dates" value={`${cohort?.startDate ? new Date(cohort.startDate).toLocaleDateString("en-US") : "-"} - ${cohort?.endDate ? new Date(cohort.endDate).toLocaleDateString("en-US") : "-"}`} />
                  <DetailField label="Timezone" value={cohort?.defaultTimezone ?? "-"} />
                  <DetailField label="Slug" value={cohort?.slug ?? "-"} />
                  <DetailField label="Public Registration" value={cohort?.publicRegistrationEnabled ? "Enabled" : "Off"} />
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
              action={
                <Button
                  disabled={!cohort?.readiness?.ready || publishingCohort}
                  onClick={publishReadyCohort}
                  startIcon={<SendOutlined />}
                >
                  {publishingCohort ? "Publishing" : "Publish Cohort"}
                </Button>
              }
            >
              <div className="readiness-command">
                <div className="readiness-summary">
                  <StatusChip value={cohort?.status} />
                  <span>{cohort?.readiness?.ready ? "All systems are ready for publication." : "Complete these systems before this cohort can become Published."}</span>
                </div>
                <div className="readiness-list readiness-metric-grid">
                  {readinessItems.map((item: AdminRow) => {
                    const icon =
                      item.key === "calendar" ? <CalendarMonthOutlined /> :
                          item.key === "communications" ? <EmailOutlined /> :
                          item.key === "manual-tasks" ? <CheckCircleOutline /> :
                            <CheckCircleOutline />;

                    return (
                      <div className={`readiness-row readiness-metric-card ${item.ready ? "is-ready" : "needs-work"}`} key={item.key}>
                        <span className={`readiness-metric-icon ${item.ready ? "is-done" : "is-missing"}`}>
                          {item.ready ? <CheckCircleOutline /> : icon}
                        </span>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="readiness-action-grid readiness-action-rail">
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<CalendarMonthOutlined />}
                    disabled={preparingInvites || sessions.length === 0}
                    onClick={prepareAllCalendarInvites}
                  >
                    {preparingInvites ? "Preparing" : "Prepare Invites"}
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<SendOutlined />}
                    disabled={creatingSessionEmails || sessions.length === 0}
                    onClick={createAllMissingSessionEmailSchedules}
                  >
                    {creatingSessionEmails ? "Creating" : "Create Emails"}
                  </Button>
                  <Button variant="text" size="small" startIcon={<AddIcon />} onClick={() => openMaterialDialog()}>
                    Add Material
                  </Button>
                  <Button variant="text" size="small" startIcon={<AddIcon />} onClick={() => setTaskDialogOpen(true)}>
                    Add Task
                  </Button>
                </div>
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
                const emailSummary = sessionEmailSummary(session.id);

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
                  {renderReadinessIcon(session.calendarInviteStatus === "CREATED" || session.calendarInviteStatus === "UPDATED", formatStatusLabel(session.calendarInviteStatus), async () => {
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
                      className={`session-check session-material-summary ${sessionMaterials.length > 0 ? "is-done" : "is-missing"}`}
                      title={sessionMaterials.length > 0 ? `${sessionMaterials.length} material${sessionMaterials.length === 1 ? "" : "s"}` : "Add session material"}
                      onClick={(event) => {
                        event.stopPropagation();
                        openMaterialDialog(session);
                      }}
                    >
                      {sessionMaterials.length > 0 ? <CheckCircleOutline /> : <CancelOutlined />}
                      <span>{sessionMaterials.length || "Add"}</span>
                    </button>
                  </div>
                  <RowActionMenu
                    actions={[
                      { label: "Edit session", icon: <EditOutlined fontSize="small" />, onClick: () => { setEditingSession(session); setSessionDialogOpen(true); } },
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
                      }
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
        <SectionCard title="Registrations" action={<Button href="/registrations" startIcon={<AddIcon />}>Add/Edit Registration</Button>}>
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
          <TableShell>
            <AppDataGrid
              rows={filteredRegistrations}
              columns={registrationColumns}
              loading={loading}
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              onRowClick={(params) => void openRegistrationDetail(params.row)}
            />
          </TableShell>
          {!loading && filteredRegistrations.length === 0 && <EmptyState title="No registrations found" description="Registrations for this cohort will appear here, or adjust payment and roster filters." />}
        </SectionCard>
      )}

      {tab === 2 && (
        <SectionCard title="Participants" action={<Button href="/participants" startIcon={<AddIcon />}>Add/Edit Participant</Button>}>
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
              onClick={() => {
                const selected = participants.filter((participant) => participantSelection.ids.has(participant.id));
                void Promise.all(selected.map((participant) => sendParticipantMessage(participant)));
              }}
            >
              Message Selected
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
        <SectionCard title="Communications">
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
                      <Typography variant="body2" color="text.secondary">QuickBooks stays as reference/status in this sprint.</Typography>
                    </div>
                    <Button size="small" onClick={saveDistributionSettings}>Save</Button>
                  </div>
                  <div className="finance-settings-grid">
                    <TextField label="RPD %" type="number" value={distributionSettings.commissionPercent} onChange={(event) => setDistributionSettings((values) => ({ ...values, commissionPercent: event.target.value }))} />
                    <TextField label="TL %" type="number" value={distributionSettings.tlSharePercent} onChange={(event) => setDistributionSettings((values) => ({ ...values, tlSharePercent: event.target.value }))} />
                    <TextField label="TL name" value={distributionSettings.tlName} onChange={(event) => setDistributionSettings((values) => ({ ...values, tlName: event.target.value }))} />
                    <TextField label="Notes" value={distributionSettings.notes} onChange={(event) => setDistributionSettings((values) => ({ ...values, notes: event.target.value }))} />
                  </div>
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
              <small>{financeHealth?.sendgridReady ? "Invoice and receipt send actions are enabled." : "PDFs can still be generated and opened; sending requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."}</small>
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
                      { label: invoice.pdfUrl ? "Regenerate PDF" : "Generate PDF", onClick: () => void generateInvoiceDocument(invoice) },
                      ...(invoice.pdfUrl ? [{ label: "Open PDF", onClick: () => window.open(invoice.pdfUrl, "_blank", "noreferrer") }] : []),
                      { label: financeHealth?.sendgridReady === false ? "Send invoice unavailable" : "Send invoice", disabled: financeHealth?.sendgridReady === false, onClick: () => void sendInvoiceDocument(invoice) },
                      { label: invoice.receiptUrl ? "Regenerate receipt" : "Generate receipt", onClick: () => void generateInvoiceDocument(invoice, true) },
                      ...(invoice.receiptUrl ? [
                        { label: "Open receipt", onClick: () => window.open(invoice.receiptUrl, "_blank", "noreferrer") },
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
              <DetailField label="Pending" value={money(totals.pendingAmount)} />
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

      <MutationDialog
        title={editingSession ? "Edit Session" : "Add Session"}
        open={sessionDialogOpen}
        fields={sessionFields}
        initialValues={editingSession ?? { timezone: cohort?.defaultTimezone ?? "America/New_York", sessionNumber: sessions.length + 1 }}
        onClose={() => { setSessionDialogOpen(false); setEditingSession(null); }}
        onSubmit={saveSession}
      />
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
        }}
        onError={notifyError}
      />
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
        actions={<Button href="/registrations" variant="outlined">Open Registrations</Button>}
      >
        {registrationDetail && (
          <>
            <div className="quick-view-grid">
              <DetailField label="Contact" value={registrationDetail.primaryContactName} proper />
              <DetailField label="Email" value={registrationDetail.primaryContactEmail} />
              <DetailField label="Phone" value={registrationDetail.primaryContactPhone} />
              <DetailField label="Organization" value={registrationDetail.organization?.name} proper />
              <DetailField label="Participants" value={registrationDetail.participantCount} />
              <DetailField label="Total" value={money(registrationDetail.totalAmount)} />
              <DetailField label="Payment" value={formatStatusLabel(registrationDetail.paymentStatus)} />
              <DetailField label="Roster" value={formatStatusLabel(registrationDetail.participantListStatus)} />
              <DetailField label="Supporting Docs" value={formatStatusLabel(registrationDetail.supportingDocumentStatus)} />
              <DetailField label="Invoice" value={registrationDetail.invoiceNumber} />
              <DetailField label="PO" value={registrationDetail.purchaseOrderNumber} />
              <DetailField label="Source" value={registrationDetail.source} />
            </div>
            <SectionCard title="Notes">
              <Typography color="text.secondary">{registrationDetail.notes ?? "No notes captured yet."}</Typography>
            </SectionCard>
            <SectionCard title="Team Roster">
              <RosterWorkbench
                registration={registrationDetail}
                existingParticipants={registrationDetail.participants ?? []}
                onImport={importRegistrationRoster}
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
            <SectionCard
              title="POC Communication History"
              action={registrationDetail.primaryContactEmail ? (
                <Button href={`/communications?search=${encodeURIComponent(registrationDetail.primaryContactEmail)}`} variant="outlined" size="small">
                  Open in Communications
                </Button>
              ) : null}
            >
              {registrationThreadLoading ? (
                <Typography color="text.secondary">Loading communication history...</Typography>
              ) : registrationThread.length > 0 ? (
                <div className="quick-view-list">
                  {registrationThread.map((communication) => (
                    <div className="quick-view-list-row" key={communication.id}>
                      <div>
                        <strong>{communication.subject ?? "Email event"}</strong>
                        <span>
                          {communication.cohort?.title ?? communication.communication?.cohort?.title ?? "Mission Control"} · {formatStatusLabel(communication.status)}
                          {communication.emailSummary?.lastEmailEvent ? ` · ${formatStatusLabel(communication.emailSummary.lastEmailEvent)}` : ""}
                          {communicationIssueLabel(communication) ? ` · ${communicationIssueLabel(communication)}` : ""}
                        </span>
                        {communication.attachments?.length > 0 && <span>{communication.attachments.length} attachment{communication.attachments.length === 1 ? "" : "s"}</span>}
                      </div>
                      <DateBadge value={communication.sentAt ?? communication.createdAt} />
                    </div>
                  ))}
                </div>
              ) : (
                <Typography color="text.secondary">No outbound email history found for this POC yet.</Typography>
              )}
            </SectionCard>
          </>
        )}
      </QuickViewDrawer>
      <QuickViewDrawer
        title="Participant Detail"
        open={Boolean(participantDetail)}
        onClose={() => setParticipantDetail(null)}
        actions={participantDetail && <Button startIcon={<SendOutlined />} onClick={() => void sendParticipantMessage(participantDetail)}>Send Message</Button>}
      >
        {participantDetail && (
          <>
            <div className="quick-view-grid">
              <DetailField label="Participant" value={`${participantDetail.firstName ?? ""} ${participantDetail.lastName ?? ""}`} proper />
              <DetailField label="Email" value={participantDetail.email} />
              <DetailField label="Phone" value={participantDetail.phone} />
              <DetailField label="Title" value={participantDetail.title} />
              <DetailField label="Status" value={formatStatusLabel(participantDetail.status)} />
              <DetailField label="Certificate" value={participantDetail.certificateIssued ? "Issued" : "Not issued"} />
              <DetailField label="Organization" value={participantDetail.organization?.name} proper />
              <DetailField label="Registration POC" value={participantDetail.registration?.primaryContactName} proper />
              <DetailField label="Payment" value={formatStatusLabel(participantDetail.registration?.paymentStatus)} />
              <DetailField label="Amount" value={money(participantDetail.registration?.totalAmount)} />
              <DetailField label="Last Email" value={participantDetail.emailSummary?.lastEmailEvent ?? "-"} />
              <DetailField label="Last Email Sent" value={participantDetail.emailSummary?.lastEmailEventAt ? new Date(participantDetail.emailSummary.lastEmailEventAt).toLocaleString("en-US") : "-"} />
            </div>
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
