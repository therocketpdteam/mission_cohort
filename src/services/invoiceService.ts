import { InvoiceDraftStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateInput, moneyInput, positiveIntInput } from "@/lib/validators";
import { buildSimplePdf } from "./pdfService";
import { uploadAppFile } from "./storageService";

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  quantity: positiveIntInput.default(1),
  unitAmount: moneyInput.default(0)
});

export const invoiceDraftInputSchema = z.object({
  id: z.string().optional(),
  cohortId: z.string().min(1),
  registrationId: z.string().optional(),
  organizationId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  issueDate: dateInput.optional(),
  dueDate: dateInput.optional(),
  status: z.nativeEnum(InvoiceDraftStatus).optional(),
  taxAmount: moneyInput.default(0),
  paidAmount: moneyInput.default(0),
  notes: z.string().optional(),
  quickBooksCustomerRef: z.string().optional(),
  quickBooksInvoiceRef: z.string().optional(),
  quickBooksRealmId: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1).optional()
});

function invoiceInclude() {
  return {
    cohort: { include: { presenter: true } },
    registration: { include: { organization: true } },
    organization: true,
    lineItems: true
  };
}

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function invoiceTotals(lineItems: Array<{ quantity: unknown; unitAmount: unknown }>, taxAmount: unknown) {
  const subtotalAmount = lineItems.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unitAmount ?? 0), 0);
  return { subtotalAmount, taxAmount: toNumber(taxAmount), totalAmount: subtotalAmount + toNumber(taxAmount) };
}

function formatDate(value: unknown) {
  return value ? new Date(value as string | Date).toLocaleDateString() : "-";
}

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function listInvoiceDrafts(cohortId?: string) {
  return prisma.invoiceDraft.findMany({
    where: cohortId ? { cohortId } : undefined,
    orderBy: { updatedAt: "desc" },
    include: invoiceInclude()
  });
}

export async function createInvoiceDraft(input: z.input<typeof invoiceDraftInputSchema>) {
  const data = invoiceDraftInputSchema.parse(input);
  const fallbackRegistration = data.registrationId
    ? await prisma.registration.findUnique({ where: { id: data.registrationId }, include: { organization: true, cohort: true } })
    : null;
  const registration = await fallbackRegistration;
  const lineItems = data.lineItems ?? [
    {
      description: registration ? `${registration.cohort.title} registration seats` : "Cohort registration",
      quantity: registration?.participantCount ?? 1,
      unitAmount: registration?.participantCount ? Number(registration.totalAmount ?? 0) / Math.max(registration.participantCount, 1) : 0
    }
  ];
  const totals = invoiceTotals(lineItems, data.taxAmount);

  return prisma.invoiceDraft.create({
    data: {
      cohortId: data.cohortId,
      registrationId: data.registrationId,
      organizationId: data.organizationId ?? registration?.organizationId,
      invoiceNumber: data.invoiceNumber ?? registration?.invoiceNumber,
      purchaseOrderNumber: data.purchaseOrderNumber ?? registration?.purchaseOrderNumber,
      issueDate: data.issueDate ?? new Date(),
      dueDate: data.dueDate,
      status: data.status ?? InvoiceDraftStatus.DRAFT,
      subtotalAmount: totals.subtotalAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      paidAmount: data.paidAmount,
      quickBooksCustomerRef: data.quickBooksCustomerRef ?? registration?.quickBooksCustomerRef,
      quickBooksInvoiceRef: data.quickBooksInvoiceRef ?? registration?.quickBooksInvoiceRef,
      quickBooksRealmId: data.quickBooksRealmId ?? registration?.quickBooksRealmId,
      notes: data.notes,
      lineItems: {
        create: lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          totalAmount: Number(item.quantity ?? 0) * Number(item.unitAmount ?? 0)
        }))
      }
    },
    include: invoiceInclude()
  });
}

export async function updateInvoiceDraft(id: string, input: z.input<typeof invoiceDraftInputSchema>) {
  const data = invoiceDraftInputSchema.partial().parse(input);
  const lineItems = data.lineItems;
  const totals = lineItems ? invoiceTotals(lineItems, data.taxAmount) : null;

  return prisma.$transaction(async (tx) => {
    if (lineItems) {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceDraftId: id } });
      await tx.invoiceLineItem.createMany({
        data: lineItems.map((item) => ({
          invoiceDraftId: id,
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          totalAmount: Number(item.quantity ?? 0) * Number(item.unitAmount ?? 0)
        }))
      });
    }

    return tx.invoiceDraft.update({
      where: { id },
      data: {
        invoiceNumber: data.invoiceNumber,
        purchaseOrderNumber: data.purchaseOrderNumber,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        status: data.status,
        subtotalAmount: totals?.subtotalAmount,
        taxAmount: totals?.taxAmount ?? data.taxAmount,
        totalAmount: totals?.totalAmount,
        paidAmount: data.paidAmount,
        notes: data.notes,
        quickBooksCustomerRef: data.quickBooksCustomerRef,
        quickBooksInvoiceRef: data.quickBooksInvoiceRef,
        quickBooksRealmId: data.quickBooksRealmId
      },
      include: invoiceInclude()
    });
  });
}

function invoicePdfLines(invoice: Awaited<ReturnType<typeof createInvoiceDraft>> | Awaited<ReturnType<typeof updateInvoiceDraft>>, receipt = false) {
  const organization = invoice.organization ?? invoice.registration?.organization;
  return [
    `Invoice #: ${invoice.invoiceNumber ?? invoice.id.slice(-8)}`,
    `Status: ${receipt ? "PAID RECEIPT" : invoice.status}`,
    `Organization: ${organization?.name ?? "-"}`,
    `Cohort: ${invoice.cohort.title}`,
    `PO Number: ${invoice.purchaseOrderNumber ?? "-"}`,
    `Issue Date: ${formatDate(invoice.issueDate)}`,
    `Due Date: ${formatDate(invoice.dueDate)}`,
    "",
    "Line Items",
    ...invoice.lineItems.map((item) => `${item.description} | Qty ${item.quantity} | ${money(item.unitAmount)} | ${money(item.totalAmount)}`),
    "",
    `Subtotal: ${money(invoice.subtotalAmount)}`,
    `Tax: ${money(invoice.taxAmount)}`,
    `Total: ${money(invoice.totalAmount)}`,
    `Paid: ${money(invoice.paidAmount)}`,
    `Balance: ${money(Number(invoice.totalAmount) - Number(invoice.paidAmount))}`,
    "",
    invoice.notes ? `Notes: ${invoice.notes}` : ""
  ].filter(Boolean);
}

export async function generateInvoicePdf(id: string, receipt = false) {
  const invoice = await prisma.invoiceDraft.findUnique({
    where: { id },
    include: invoiceInclude()
  });

  if (!invoice) {
    throw Object.assign(new Error("Invoice draft not found."), { code: "NOT_FOUND", status: 404 });
  }

  const pdf = buildSimplePdf(receipt ? "RocketPD Receipt" : "RocketPD Invoice", invoicePdfLines(invoice, receipt));
  const upload = await uploadAppFile({
    purpose: receipt ? "receipt" : "invoice",
    fileName: `${receipt ? "receipt" : "invoice"}-${invoice.invoiceNumber ?? invoice.id}.pdf`,
    contentType: "application/pdf",
    bytes: pdf
  });

  return prisma.invoiceDraft.update({
    where: { id },
    data: receipt ? { receiptFileKey: upload.fileKey, receiptUrl: upload.url, status: InvoiceDraftStatus.PAID } : { pdfFileKey: upload.fileKey, pdfUrl: upload.url },
    include: invoiceInclude()
  });
}
