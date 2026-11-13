import { readCheckPaymentProof } from "./checkPayment";
import { registrationCollectedAmount } from "./cohortFinance";

type FinanceRegistration = Omit<Parameters<typeof registrationCollectedAmount>[0], "paymentRecords" | "invoiceDrafts"> & {
  purchaseOrderNumber?: string | null;
  purchaseOrderFileKey?: string | null;
  checkPaymentFileKey?: string | null;
  quickBooksSyncError?: string | null;
  paymentRecords?: Array<{ method?: string; status?: string; amount?: unknown; notes?: unknown }>;
  invoiceDrafts?: Array<{ status?: string; paidAmount?: unknown; dueDate?: unknown; totalAmount?: unknown; quickBooksSyncError?: string | null }>;
};

export function registrationFinanceAlerts(registration: FinanceRegistration, now = new Date()) {
  const invoices = (registration.invoiceDrafts ?? []).filter(invoice => !["VOIDED", "CANCELLED"].includes(String(invoice.status)));
  const payments = registration.paymentRecords ?? [];
  const active = !registration.archivedAt && registration.status !== "CANCELLED" && !["CANCELLED", "REFUNDED"].includes(String(registration.paymentStatus));
  const collected = registrationCollectedAmount(registration);
  const hasBalance = active && registration.paymentStatus !== "PAID" && collected < Number(registration.totalAmount ?? 0);
  const missingPo = hasBalance && registration.paymentMethod === "PURCHASE_ORDER" && (!registration.purchaseOrderNumber || !registration.purchaseOrderFileKey);
  const checkReceived = payments.some(payment => payment.method === "CHECK" && ["PAID", "PARTIALLY_PAID"].includes(String(payment.status))) || (registration.paymentMethod === "CHECK" && ["PAID", "PARTIALLY_PAID"].includes(String(registration.paymentStatus)));
  const missingCheckProof = active && checkReceived && !registration.checkPaymentFileKey && !payments.some(payment => readCheckPaymentProof(payment.notes));
  const overdueInvoices = hasBalance ? invoices.filter(invoice => invoice.status !== "PAID" && invoice.dueDate && new Date(String(invoice.dueDate)).getTime() < now.getTime() && Number(invoice.paidAmount ?? 0) < Number(invoice.totalAmount ?? 0)).length : 0;
  const missingInvoice = hasBalance && ["INVOICE", "PURCHASE_ORDER"].includes(String(registration.paymentMethod)) && invoices.length === 0;
  const syncErrors = Boolean(registration.quickBooksSyncError) || invoices.some(invoice => invoice.quickBooksSyncError);
  return {
    documents: Number(missingPo) + Number(missingCheckProof),
    invoice: Number(missingInvoice) + overdueInvoices + Number(syncErrors) + Number(collected > Number(registration.totalAmount ?? 0))
  };
}
