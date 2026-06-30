import { CommunicationStatus, InvoiceDraftStatus, RecipientScope } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateInput, moneyInput, positiveIntInput } from "@/lib/validators";
import { buildInvoicePdf } from "./pdfService";
import { uploadAppFile } from "./storageService";
import { addCommunicationAttachment, getSystemUserId, sendCommunication } from "./communicationService";
import { getOrganizationInvoiceProfile } from "./appSettingsService";

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

function slugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toUpperCase();
}

function presenterInvoiceCode(presenter?: { firstName?: string | null; lastName?: string | null } | null) {
  const fullName = `${presenter?.firstName ?? ""} ${presenter?.lastName ?? ""}`.trim();
  const known: Record<string, string> = {
    "kim marshall": "KM",
    "peter liljedahl": "PL",
    "jessica garcia": "JG",
    "the core group": "TCG"
  };
  const key = fullName.toLowerCase();
  if (known[key]) {
    return known[key];
  }

  const words = fullName.split(/\s+/).filter(Boolean);
  return (words.length ? words.map((word) => word[0]).join("") : "RPD").slice(0, 3).toUpperCase();
}

async function defaultInvoiceNumber(input: {
  id: string;
  cohort: { presenter?: { firstName?: string | null; lastName?: string | null } | null };
  organizationName?: string | null;
  invoiceDraftClient?: Pick<typeof prisma.invoiceDraft, "findMany">;
}) {
  const base = [
    presenterInvoiceCode(input.cohort.presenter),
    slugPart(input.organizationName || "COHORT")
  ].filter(Boolean).join("-");
  const invoiceDraftClient = input.invoiceDraftClient ?? prisma.invoiceDraft;
  const existing = await invoiceDraftClient.findMany({
    where: {
      id: { not: input.id },
      invoiceNumber: {
        startsWith: base
      }
    },
    select: { invoiceNumber: true }
  });

  if (!existing.some((row) => row.invoiceNumber === base)) {
    return base;
  }

  let suffix = existing.length + 1;
  while (existing.some((row) => row.invoiceNumber === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

const printableInvoiceFields = new Set([
  "invoiceNumber",
  "purchaseOrderNumber",
  "issueDate",
  "dueDate",
  "status",
  "taxAmount",
  "paidAmount",
  "notes",
  "lineItems"
]);

export function shouldInvalidateInvoiceDocuments(input: Record<string, unknown>) {
  return Object.keys(input).some((key) => printableInvoiceFields.has(key));
}

function dedupeEmails(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function defaultLineItemDescription(cohort: { title: string; description?: string | null }) {
  return [cohort.title, cohort.description].filter(Boolean).join(" - ");
}

async function fetchInvoiceLogo(logoUrl?: string | null) {
  if (!logoUrl) {
    return null;
  }

  try {
    const response = await fetch(logoUrl, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok || !contentType.toLowerCase().startsWith("image/png")) {
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 2 * 1024 * 1024) {
      return null;
    }

    return { bytes, contentType };
  } catch {
    return null;
  }
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
    ? await prisma.registration.findUnique({ where: { id: data.registrationId }, include: { organization: true, cohort: { include: { presenter: true } } } })
    : null;
  const registration = await fallbackRegistration;
  const fallbackCohort = registration?.cohort ?? await prisma.cohort.findUniqueOrThrow({ where: { id: data.cohortId }, include: { presenter: true } });

  if (registration?.archivedAt) {
    throw Object.assign(new Error("Archived registrations cannot be invoiced."), { code: "BAD_REQUEST", status: 400 });
  }

  const lineItems = data.lineItems ?? [
    {
      description: registration ? defaultLineItemDescription(registration.cohort) : defaultLineItemDescription(fallbackCohort),
      quantity: registration?.participantCount ?? 1,
      unitAmount: registration?.participantCount ? Number(registration.totalAmount ?? 0) / Math.max(registration.participantCount, 1) : 0
    }
  ];
  const totals = invoiceTotals(lineItems, data.taxAmount);

  return prisma.$transaction(async (tx) => {
    const created = await tx.invoiceDraft.create({
      data: {
        cohortId: data.cohortId,
        registrationId: data.registrationId,
        organizationId: data.organizationId ?? registration?.organizationId,
        invoiceNumber: data.invoiceNumber,
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
      }
    });

    if (created.invoiceNumber) {
      return tx.invoiceDraft.findUniqueOrThrow({
        where: { id: created.id },
        include: invoiceInclude()
      });
    }

    const organizationName = registration?.organization?.name ?? (data.organizationId
      ? (await tx.organization.findUnique({ where: { id: data.organizationId }, select: { name: true } }))?.name
      : null);

    return tx.invoiceDraft.update({
      where: { id: created.id },
      data: {
        invoiceNumber: await defaultInvoiceNumber({
          id: created.id,
          cohort: fallbackCohort,
          organizationName,
          invoiceDraftClient: tx.invoiceDraft
        })
      },
      include: invoiceInclude()
    });
  });
}

export async function updateInvoiceDraft(id: string, input: z.input<typeof invoiceDraftInputSchema>) {
  const data = invoiceDraftInputSchema.partial().parse(input);
  const lineItems = data.lineItems;
  const totals = lineItems ? invoiceTotals(lineItems, data.taxAmount) : null;
  const shouldRegenerateDocuments = shouldInvalidateInvoiceDocuments(data);

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
        quickBooksRealmId: data.quickBooksRealmId,
        ...(shouldRegenerateDocuments
          ? {
              pdfFileKey: null,
              pdfUrl: null,
              receiptFileKey: null,
              receiptUrl: null
            }
          : {})
      },
      include: invoiceInclude()
    });
  });
}

async function invoicePdfInput(invoice: Awaited<ReturnType<typeof createInvoiceDraft>> | Awaited<ReturnType<typeof updateInvoiceDraft>>, receipt = false) {
  const organization = invoice.organization ?? invoice.registration?.organization;
  const balanceAmount = Math.max(Number(invoice.totalAmount) - Number(invoice.paidAmount), 0);
  const invoiceProfile = await getOrganizationInvoiceProfile();
  const logoImage = await fetchInvoiceLogo(invoiceProfile.logoUrl);

  return {
    issuer: invoiceProfile,
    logoImage,
    documentType: receipt ? "receipt" as const : "invoice" as const,
    invoiceNumber: invoice.invoiceNumber ?? invoice.id.slice(-8),
    status: String(invoice.status),
    organizationName: organization?.name ?? "Organization",
    organizationAddressLines: [
      organization?.addressLine1,
      organization?.addressLine2,
      [
        organization?.city,
        [organization?.state, organization?.zip].filter(Boolean).join(" ")
      ].filter(Boolean).join(", ")
    ].filter((line): line is string => Boolean(line)),
    contactName: invoice.registration?.billingContactName ?? invoice.registration?.primaryContactName,
    contactEmail: invoice.registration?.billingContactEmail ?? invoice.registration?.primaryContactEmail,
    cohortTitle: invoice.cohort.title,
    cohortDescription: invoice.cohort.description,
    purchaseOrderNumber: invoice.purchaseOrderNumber,
    issueDate: formatDate(invoice.issueDate),
    dueDate: formatDate(invoice.dueDate),
    lineItems: invoice.lineItems.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity ?? 0),
      unitAmount: money(item.unitAmount),
      totalAmount: money(item.totalAmount)
    })),
    subtotalAmount: money(invoice.subtotalAmount),
    taxAmount: money(invoice.taxAmount),
    totalAmount: money(invoice.totalAmount),
    paidAmount: money(invoice.paidAmount),
    balanceAmount: money(balanceAmount),
    notes: invoice.notes || invoiceProfile.paymentInstructions,
    footerNote: invoiceProfile.footerNote
  };
}

export async function generateInvoicePdf(id: string, receipt = false) {
  const invoice = await prisma.invoiceDraft.findUnique({
    where: { id },
    include: invoiceInclude()
  });

  if (!invoice) {
    throw Object.assign(new Error("Invoice draft not found."), { code: "NOT_FOUND", status: 404 });
  }

  const pdf = buildInvoicePdf(await invoicePdfInput(invoice, receipt));
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

export async function sendInvoiceDocument(id: string, receipt = false) {
  let invoice = await prisma.invoiceDraft.findUnique({
    where: { id },
    include: invoiceInclude()
  });

  if (!invoice) {
    throw Object.assign(new Error("Invoice draft not found."), { code: "NOT_FOUND", status: 404 });
  }

  if (invoice.registration?.archivedAt) {
    throw Object.assign(new Error("Archived registrations cannot receive invoice emails."), { code: "BAD_REQUEST", status: 400 });
  }

  if (receipt && !invoice.receiptFileKey) {
    invoice = await generateInvoicePdf(id, true);
  }

  if (!receipt && !invoice.pdfFileKey) {
    invoice = await generateInvoicePdf(id, false);
  }

  const organization = invoice.organization ?? invoice.registration?.organization;
  const recipients = dedupeEmails([invoice.registration?.billingContactEmail, invoice.registration?.primaryContactEmail]);

  if (recipients.length === 0) {
    throw Object.assign(new Error("No billing or POC email is available for this invoice."), { code: "BAD_REQUEST", status: 400 });
  }

  const userId = await getSystemUserId();
  const documentLabel = receipt ? "receipt" : "invoice";
  const fileName = `${receipt ? "Receipt" : "Invoice"} ${invoice.invoiceNumber ?? invoice.id}.pdf`;
  const fileKey = receipt ? invoice.receiptFileKey : invoice.pdfFileKey;
  const url = receipt ? invoice.receiptUrl : invoice.pdfUrl;

  if (!fileKey || !url) {
    throw Object.assign(new Error(`Generate the ${documentLabel} PDF before sending.`), { code: "BAD_REQUEST", status: 400 });
  }

  const communication = await prisma.cohortCommunication.create({
    data: {
      cohortId: invoice.cohortId,
      subject: `${receipt ? "Receipt" : "Invoice"} ${invoice.invoiceNumber ?? ""} for ${invoice.cohort.title}`.trim(),
      bodyHtml: receipt
        ? `<p>Hello,</p><p>Your paid receipt for <strong>${invoice.cohort.title}</strong> is attached below.</p><p>Thank you.</p>`
        : `<p>Hello,</p><p>Your invoice for <strong>${invoice.cohort.title}</strong> is attached below.</p><p>Total: <strong>${money(invoice.totalAmount)}</strong></p>`,
      bodyText: receipt
        ? `Your paid receipt for ${invoice.cohort.title} is attached below.`
        : `Your invoice for ${invoice.cohort.title} is attached below. Total: ${money(invoice.totalAmount)}.`,
      status: CommunicationStatus.DRAFT,
      recipientScope: RecipientScope.CUSTOM,
      recipientEmails: recipients,
      createdById: userId
    }
  });

  await addCommunicationAttachment({
    communicationId: communication.id,
    fileName,
    contentType: "application/pdf",
    fileKey,
    url
  });

  const sent = await sendCommunication(communication.id, {
    recipients,
    context: {
      cohort: {
        ...invoice.cohort,
        title: invoice.cohort.title,
        description: invoice.cohort.description,
        startDate: invoice.cohort.startDate,
        presenterName: `${invoice.cohort.presenter.firstName} ${invoice.cohort.presenter.lastName}`,
        presenterFirstName: invoice.cohort.presenter.firstName,
        presenterLastName: invoice.cohort.presenter.lastName,
        presenterEmail: invoice.cohort.presenter.email
      },
      organization: organization ?? undefined,
      registration: invoice.registration ? { ...invoice.registration, invoiceUrl: url } : undefined
    }
  });

  const updatedInvoice = await prisma.invoiceDraft.update({
    where: { id },
    data: receipt ? { status: InvoiceDraftStatus.PAID } : { status: InvoiceDraftStatus.SENT },
    include: invoiceInclude()
  });

  return { invoice: updatedInvoice, communication: sent, recipients };
}
