import { isCompedRegistration } from "./formatting";

type PaymentInput = { registrationId?: string | null; status?: string | null; amount?: unknown };
type InvoiceInput = { registrationId?: string | null; status?: string | null; paidAmount?: unknown };
type RegistrationInput = {
  id?: string;
  status?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  archivedAt?: unknown;
  totalAmount?: unknown;
  participantCount?: unknown;
  paymentRecords?: PaymentInput[];
  invoiceDrafts?: InvoiceInput[];
};

const status = (value: unknown) => String(value ?? "").toUpperCase();
const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

function relatedRows<T extends { registrationId?: string | null }>(registration: RegistrationInput, rows: T[] | undefined, fallback: T[] | undefined) {
  const related = registration.id ? rows?.filter(row => row.registrationId === registration.id) : undefined;
  return related?.length ? related : fallback ?? [];
}

export function registrationCollectedAmount(registration: RegistrationInput, paymentRows?: PaymentInput[], invoiceRows?: InvoiceInput[]) {
  if (isCompedRegistration({
    paymentMethod: registration.paymentMethod,
    paymentStatus: registration.paymentStatus,
    totalAmount: amount(registration.totalAmount),
    participantCount: amount(registration.participantCount)
  })) return 0;

  const fromPayments = relatedRows(registration, paymentRows, registration.paymentRecords)
    .filter(payment => ["PAID", "PARTIALLY_PAID"].includes(status(payment.status)))
    .reduce((sum, payment) => sum + amount(payment.amount), 0);
  const fromInvoices = relatedRows(registration, invoiceRows, registration.invoiceDrafts)
    .filter(invoice => !["VOIDED", "CANCELLED"].includes(status(invoice.status)))
    .reduce((sum, invoice) => sum + amount(invoice.paidAmount), 0);
  const recorded = Math.max(fromPayments, fromInvoices);

  return recorded > 0 ? recorded : status(registration.paymentStatus) === "PAID" ? amount(registration.totalAmount) : 0;
}

function groupByRegistration<T extends { registrationId?: string | null }>(rows: T[] = []) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.registrationId) continue;
    const group = grouped.get(row.registrationId) ?? [];
    group.push(row);
    grouped.set(row.registrationId, group);
  }
  return grouped;
}

export function calculateCohortFinance(input: { registrations: RegistrationInput[]; payments?: PaymentInput[]; invoices?: InvoiceInput[] }) {
  const payments = groupByRegistration(input.payments), invoices = groupByRegistration(input.invoices);
  let totalSales = 0, paidAmount = 0, uncollectibleAmount = 0;

  for (const registration of input.registrations) {
    if (registration.archivedAt || status(registration.status) === "CANCELLED" || ["CANCELLED", "REFUNDED"].includes(status(registration.paymentStatus))) continue;
    const total = amount(registration.totalAmount);
    const collected = registrationCollectedAmount(registration, payments.get(registration.id ?? ""), invoices.get(registration.id ?? ""));
    totalSales += total;
    paidAmount += collected;
    if (status(registration.paymentStatus) === "UNCOLLECTIBLE") uncollectibleAmount += Math.max(total - collected, 0);
  }

  totalSales = roundMoney(totalSales);
  paidAmount = roundMoney(paidAmount);
  uncollectibleAmount = roundMoney(uncollectibleAmount);
  const collectibleSales = roundMoney(Math.max(totalSales - uncollectibleAmount, 0));
  const outstandingAmount = roundMoney(Math.max(collectibleSales - paidAmount, 0));
  const paidPercent = collectibleSales <= 0 ? 0 : outstandingAmount <= 0 ? 100
    : Math.max(0, Math.min(99.9, Math.round(paidAmount / collectibleSales * 1000) / 10));

  return { totalSales, collectibleSales, paidAmount, uncollectibleAmount, outstandingAmount, paidPercent };
}

export type CohortFinanceSummary = ReturnType<typeof calculateCohortFinance>;
