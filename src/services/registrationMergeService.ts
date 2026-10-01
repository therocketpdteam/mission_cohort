import { CommunicationStatus, InvoiceDraftStatus, Prisma, RecipientScope, RegistrationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrationTotalForCohort, pricePerParticipantForCohort } from "@/config/cohortPricing";
import { addCommunicationAttachment, getSystemUserId, sendCommunication } from "./communicationService";
import { generateInvoicePdf } from "./invoiceService";
import { logAuditEvent } from "./auditService";
import { queueRegistrationCrmSync } from "./crmSyncService";

const mergeInclude = {
  cohort: { include: { sessions: true } },
  participants: true,
  paymentRecords: true,
  invoiceDrafts: { include: { lineItems: true }, orderBy: { updatedAt: "desc" as const } },
  communications: true,
  operationsTasks: true
};

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function previewRegistrationMerge(targetId: string, sourceId: string) {
  if (!targetId || !sourceId || targetId === sourceId) {
    throw Object.assign(new Error("Choose two different registrations."), { code: "BAD_REQUEST", status: 400 });
  }

  const [target, source] = await Promise.all([
    prisma.registration.findUnique({ where: { id: targetId }, include: mergeInclude }),
    prisma.registration.findUnique({ where: { id: sourceId }, include: mergeInclude })
  ]);
  if (!target || !source) {
    throw Object.assign(new Error("One of the registrations could not be found."), { code: "NOT_FOUND", status: 404 });
  }

  const targetEmails = new Set(target.participants.map((participant) => participant.email.trim().toLowerCase()));
  const duplicateParticipantEmails = source.participants
    .map((participant) => participant.email.trim().toLowerCase())
    .filter((email) => targetEmails.has(email));
  const targetInvoice = target.invoiceDrafts[0] ?? null;
  const sourceInvoice = source.invoiceDrafts[0] ?? null;
  const combinedSeats = target.participantCount + source.participantCount;
  const combinedParticipantRecords = target.participants.length + source.participants.length;
  const unitAmount = pricePerParticipantForCohort(target.cohort, combinedSeats);
  const totalAmount = registrationTotalForCohort(target.cohort, combinedSeats);
  const blockers: string[] = [];

  if (target.cohortId !== source.cohortId) blockers.push("Registrations must belong to the same cohort.");
  if (target.organizationId !== source.organizationId) blockers.push("Registrations must belong to the same organization.");
  if (target.primaryContactEmail.trim().toLowerCase() !== source.primaryContactEmail.trim().toLowerCase()) blockers.push("Registrations must have the same primary-contact email.");
  if (target.archivedAt || source.archivedAt) blockers.push("Archived registrations cannot be merged.");
  if (duplicateParticipantEmails.length) blockers.push(`Resolve duplicate participant emails first: ${duplicateParticipantEmails.join(", ")}.`);
  if (combinedParticipantRecords !== combinedSeats) blockers.push(`Saved participant records (${combinedParticipantRecords}) do not match the combined seat count (${combinedSeats}).`);
  if (!targetInvoice) blockers.push("The surviving registration needs an invoice draft.");
  if (targetInvoice && targetInvoice.lineItems.length !== 1) blockers.push("The surviving invoice has custom line items and must be reviewed manually.");
  if (source.paymentRecords.length > 0) blockers.push("The newer registration has payment records and requires a finance review before merging.");
  if (source.purchaseOrderNumber || source.purchaseOrderFileKey || source.checkPaymentFileKey) blockers.push("The newer registration has payment documentation that must be reviewed before merging.");
  if (target.quickBooksInvoiceRef || source.quickBooksInvoiceRef || targetInvoice?.quickBooksInvoiceRef || sourceInvoice?.quickBooksInvoiceRef) {
    blockers.push("QuickBooks-linked registrations cannot be merged until the invoice links are reviewed.");
  }

  return {
    target: {
      id: target.id,
      createdAt: target.createdAt,
      invoiceNumber: targetInvoice?.invoiceNumber ?? target.invoiceNumber,
      participantCount: target.participantCount,
      participantRecords: target.participants.length,
      totalAmount: Number(target.totalAmount),
      notes: target.notes
    },
    source: {
      id: source.id,
      createdAt: source.createdAt,
      invoiceNumber: sourceInvoice?.invoiceNumber ?? source.invoiceNumber,
      participantCount: source.participantCount,
      participantRecords: source.participants.length,
      totalAmount: Number(source.totalAmount)
    },
    result: {
      participantCount: combinedSeats,
      participantRecords: combinedParticipantRecords,
      unitAmount,
      totalAmount,
      survivingInvoiceNumber: targetInvoice?.invoiceNumber ?? target.invoiceNumber,
      supersededInvoiceNumber: sourceInvoice?.invoiceNumber ?? source.invoiceNumber,
      participantEmails: [...target.participants, ...source.participants].map((participant) => participant.email.toLowerCase())
    },
    communication: {
      pocEmail: target.primaryContactEmail.toLowerCase(),
      participantsNotified: 0,
      calendarChanges: 0
    },
    blockers
  };
}

export async function mergeRegistrations(input: { targetId: string; sourceId: string; sendPocSummary?: boolean }) {
  const preview = await previewRegistrationMerge(input.targetId, input.sourceId);
  if (preview.blockers.length) {
    throw Object.assign(new Error(preview.blockers.join(" ")), { code: "BAD_REQUEST", status: 400 });
  }

  const targetInvoice = await prisma.invoiceDraft.findFirst({
    where: { registrationId: input.targetId },
    orderBy: { updatedAt: "desc" },
    include: { lineItems: true }
  });
  if (!targetInvoice) {
    throw Object.assign(new Error("The surviving invoice could not be found."), { code: "NOT_FOUND", status: 404 });
  }

  const sourceInvoiceNumber = preview.result.supersededInvoiceNumber;
  const targetInvoiceNumber = preview.result.survivingInvoiceNumber;
  const lineDescription = targetInvoice.lineItems[0]?.description ?? "Cohort registration";
  const mergedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.participant.updateMany({ where: { registrationId: input.sourceId }, data: { registrationId: input.targetId } });
    await tx.cohortCommunication.updateMany({ where: { registrationId: input.sourceId }, data: { registrationId: input.targetId } });
    await tx.webhookEvent.updateMany({ where: { registrationId: input.sourceId }, data: { registrationId: input.targetId } });
    await tx.operationsTask.updateMany({
      where: { registrationId: input.sourceId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", completedAt: mergedAt }
    });

    const sourceInvoices = await tx.invoiceDraft.findMany({ where: { registrationId: input.sourceId } });
    for (const invoice of sourceInvoices) {
      await tx.invoiceDraft.update({
        where: { id: invoice.id },
        data: {
          registrationId: null,
          status: InvoiceDraftStatus.VOIDED,
          notes: [invoice.notes, `Superseded by ${targetInvoiceNumber ?? input.targetId} after registration merge on ${mergedAt.toISOString()}.`].filter(Boolean).join("\n")
        }
      });
    }

    await tx.invoiceLineItem.deleteMany({ where: { invoiceDraftId: targetInvoice.id } });
    await tx.invoiceLineItem.create({
      data: {
        invoiceDraftId: targetInvoice.id,
        description: lineDescription,
        quantity: preview.result.participantCount,
        unitAmount: preview.result.unitAmount,
        totalAmount: preview.result.totalAmount
      }
    });
    await tx.invoiceDraft.update({
      where: { id: targetInvoice.id },
      data: {
        subtotalAmount: preview.result.totalAmount,
        totalAmount: preview.result.totalAmount,
        status: InvoiceDraftStatus.DRAFT,
        pdfFileKey: null,
        pdfUrl: null,
        receiptFileKey: null,
        receiptUrl: null
      }
    });
    await tx.registration.update({
      where: { id: input.targetId },
      data: {
        participantCount: preview.result.participantCount,
        totalAmount: preview.result.totalAmount,
        participantListStatus: "COMPLETE",
        invoiceUrl: null,
        notes: [preview.target.notes, `Merged registration ${input.sourceId} (${sourceInvoiceNumber ?? "no invoice"}) on ${mergedAt.toISOString()}.`].filter(Boolean).join("\n")
      }
    });
    await tx.registration.update({
      where: { id: input.sourceId },
      data: {
        status: RegistrationStatus.CANCELLED,
        participantCount: 0,
        totalAmount: 0,
        invoiceNumber: null,
        invoiceUrl: null,
        pendingChanges: Prisma.JsonNull,
        pendingChangesAt: null,
        archivedAt: mergedAt,
        archivedReason: `MERGED_INTO:${input.targetId}`
      }
    });
  });

  let invoice = null;
  let invoiceError: string | null = null;
  try {
    invoice = await generateInvoicePdf(targetInvoice.id, false);
  } catch (error) {
    invoiceError = (error as Error).message;
  }
  let communication = null;
  let communicationError: string | null = null;

  if (input.sendPocSummary && invoice) {
    try {
      const created = await prisma.cohortCommunication.create({
        data: {
          cohortId: invoice.cohortId,
          registrationId: input.targetId,
          subject: `Updated invoice ${targetInvoiceNumber ?? ""} - registrations consolidated`.trim(),
          bodyHtml: `<p>Hello ${escapeHtml((invoice.registration?.primaryContactName ?? "").split(/\s+/)[0] || "there")},</p><p>Your registrations have been consolidated into one <strong>${preview.result.participantCount}-participant registration</strong>.</p><p>Please disregard invoice <strong>${escapeHtml(sourceInvoiceNumber ?? "from the newer registration")}</strong>. The attached updated invoice <strong>${escapeHtml(targetInvoiceNumber ?? "")}</strong> replaces it and reflects ${preview.result.participantCount} participants at ${money(preview.result.unitAmount)} per participant, totaling <strong>${money(preview.result.totalAmount)}</strong>.</p><p>No action is needed regarding participant confirmations or calendar invitations.</p><p>Thank you,<br>RocketPD</p>`,
          bodyText: `Your registrations have been consolidated into one ${preview.result.participantCount}-participant registration. Please disregard invoice ${sourceInvoiceNumber ?? "from the newer registration"}. The attached updated invoice ${targetInvoiceNumber ?? ""} replaces it and reflects ${preview.result.participantCount} participants at ${money(preview.result.unitAmount)} per participant, totaling ${money(preview.result.totalAmount)}. No action is needed regarding participant confirmations or calendar invitations.`,
          status: CommunicationStatus.DRAFT,
          recipientScope: RecipientScope.CUSTOM,
          recipientEmails: [preview.communication.pocEmail],
          createdById: await getSystemUserId()
        }
      });
      if (!invoice.pdfFileKey || !invoice.pdfUrl) throw new Error("The updated invoice PDF was not generated.");
      await addCommunicationAttachment({
        communicationId: created.id,
        fileName: `Invoice ${targetInvoiceNumber ?? targetInvoice.id}.pdf`,
        contentType: "application/pdf",
        fileKey: invoice.pdfFileKey,
        url: invoice.pdfUrl
      });
      communication = await sendCommunication(created.id);
      await prisma.invoiceDraft.update({ where: { id: targetInvoice.id }, data: { status: InvoiceDraftStatus.SENT } });
    } catch (error) {
      communicationError = (error as Error).message;
    }
  } else if (input.sendPocSummary && !invoice) {
    communicationError = `The POC email was not sent because the updated invoice PDF could not be generated. ${invoiceError ?? ""}`.trim();
  }

  await Promise.all([
    logAuditEvent({
      entityType: "Registration",
      entityId: input.targetId,
      action: "MERGED",
      description: `Merged registration ${input.sourceId} into the surviving registration`,
      metadata: { sourceId: input.sourceId, ...preview.result, sendPocSummary: Boolean(input.sendPocSummary), invoiceError, communicationError }
    }),
    logAuditEvent({
      entityType: "Registration",
      entityId: input.sourceId,
      action: "MERGED_INTO",
      description: `Merged into registration ${input.targetId}`,
      metadata: { targetId: input.targetId, survivingInvoiceNumber: targetInvoiceNumber, supersededInvoiceNumber: sourceInvoiceNumber }
    })
  ]);
  void queueRegistrationCrmSync(input.targetId, "registration.merged").catch(() => undefined);
  void queueRegistrationCrmSync(input.sourceId, "registration.merged_source").catch(() => undefined);

  return { merged: true, preview, invoice, invoiceError, communication, communicationError };
}
