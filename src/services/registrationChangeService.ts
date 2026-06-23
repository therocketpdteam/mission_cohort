import { randomUUID } from "node:crypto";
import {
  CohortStatus,
  CommunicationStatus,
  InvoiceDraftStatus,
  Prisma,
  RecipientScope
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCalendarInvitePlaceholder } from "./calendarService";
import {
  addCommunicationAttachment,
  ensureDefaultCommunicationTemplates,
  getSystemUserId,
  sendCommunication
} from "./communicationService";
import { generateInvoicePdf, updateInvoiceDraft } from "./invoiceService";
import { planRegistrationJourneys } from "./registrationJourneyService";

export type PendingParticipantChange = {
  participantId: string;
  firstName: string;
  lastName: string;
  email: string;
};

export type PendingValueChange = {
  before: string | number | null;
  after: string | number | null;
};

export type RegistrationPendingChanges = {
  batchId: string;
  participantAdditions: PendingParticipantChange[];
  participantRemovals: PendingParticipantChange[];
  fields: Record<string, PendingValueChange>;
  createdAt: string;
  updatedAt: string;
  invoiceAppliedAt?: string;
  participantJourneysAppliedAt?: string;
  calendarAppliedAt?: string;
};

const trackedRegistrationFields = [
  "participantCount",
  "totalAmount",
  "purchaseOrderNumber",
  "invoiceNumber"
] as const;

function valueForJson(value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return String(value);
}

export function readRegistrationPendingChanges(value: Prisma.JsonValue | null | undefined): RegistrationPendingChanges | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (!row.batchId) {
    return null;
  }
  return {
    batchId: String(row.batchId),
    participantAdditions: Array.isArray(row.participantAdditions) ? row.participantAdditions as PendingParticipantChange[] : [],
    participantRemovals: Array.isArray(row.participantRemovals) ? row.participantRemovals as PendingParticipantChange[] : [],
    fields: row.fields && typeof row.fields === "object" && !Array.isArray(row.fields) ? row.fields as Record<string, PendingValueChange> : {},
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    invoiceAppliedAt: row.invoiceAppliedAt ? String(row.invoiceAppliedAt) : undefined,
    participantJourneysAppliedAt: row.participantJourneysAppliedAt ? String(row.participantJourneysAppliedAt) : undefined,
    calendarAppliedAt: row.calendarAppliedAt ? String(row.calendarAppliedAt) : undefined
  };
}

function emptyPendingChanges(): RegistrationPendingChanges {
  const now = new Date().toISOString();
  return {
    batchId: randomUUID(),
    participantAdditions: [],
    participantRemovals: [],
    fields: {},
    createdAt: now,
    updatedAt: now
  };
}

function resetDeliveryProgress(pending: RegistrationPendingChanges) {
  pending.updatedAt = new Date().toISOString();
  delete pending.invoiceAppliedAt;
  delete pending.participantJourneysAppliedAt;
  delete pending.calendarAppliedAt;
  return pending;
}

function copyPending(pending: RegistrationPendingChanges): RegistrationPendingChanges {
  return JSON.parse(JSON.stringify(pending)) as RegistrationPendingChanges;
}

export function mergeParticipantAddition(pending: RegistrationPendingChanges, participant: PendingParticipantChange) {
  const next = copyPending(pending);
  const revertsPendingRemoval = next.participantRemovals.some((row) =>
    row.participantId === participant.participantId && row.email.toLowerCase() === participant.email.toLowerCase()
  );
  next.participantRemovals = next.participantRemovals.filter((row) => row.email.toLowerCase() !== participant.email.toLowerCase());
  if (revertsPendingRemoval) {
    next.participantAdditions = next.participantAdditions.filter((row) => row.participantId !== participant.participantId);
    return resetDeliveryProgress(next);
  }
  next.participantAdditions = [
    ...next.participantAdditions.filter((row) => row.participantId !== participant.participantId && row.email.toLowerCase() !== participant.email.toLowerCase()),
    participant
  ];
  return resetDeliveryProgress(next);
}

export function mergeParticipantRemoval(pending: RegistrationPendingChanges, participant: PendingParticipantChange) {
  const next = copyPending(pending);
  const wasPendingAddition = next.participantAdditions.some((row) => row.participantId === participant.participantId);
  next.participantAdditions = next.participantAdditions.filter((row) => row.participantId !== participant.participantId);
  if (!wasPendingAddition) {
    next.participantRemovals = [
      ...next.participantRemovals.filter((row) => row.participantId !== participant.participantId),
      participant
    ];
  }
  return resetDeliveryProgress(next);
}

export function mergeRegistrationFieldChanges(
  pending: RegistrationPendingChanges,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const next = copyPending(pending);
  for (const field of trackedRegistrationFields) {
    const beforeValue = valueForJson(before[field]);
    const afterValue = valueForJson(after[field]);
    if (beforeValue === afterValue) {
      continue;
    }
    const original = next.fields[field]?.before ?? beforeValue;
    if (original === afterValue) {
      delete next.fields[field];
    } else {
      next.fields[field] = { before: original, after: afterValue };
    }
  }
  return resetDeliveryProgress(next);
}

async function savePendingChanges(registrationId: string, pending: RegistrationPendingChanges) {
  return prisma.registration.update({
    where: { id: registrationId },
    data: { pendingChanges: pending as unknown as Prisma.InputJsonValue, pendingChangesAt: new Date(pending.updatedAt) }
  });
}

export function shouldDeferRegistrationDelivery(status: CohortStatus) {
  return status === CohortStatus.PUBLISHED || status === CohortStatus.ACTIVE;
}

export async function stageParticipantAddition(registrationId: string, participant: PendingParticipantChange) {
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { pendingChanges: true } });
  const pending = readRegistrationPendingChanges(registration.pendingChanges) ?? emptyPendingChanges();
  return savePendingChanges(registrationId, mergeParticipantAddition(pending, participant));
}

export async function stageParticipantRemoval(registrationId: string, participant: PendingParticipantChange) {
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { pendingChanges: true } });
  const pending = readRegistrationPendingChanges(registration.pendingChanges) ?? emptyPendingChanges();
  return savePendingChanges(registrationId, mergeParticipantRemoval(pending, participant));
}

export async function stageRegistrationFieldChanges(
  registrationId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const registration = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { pendingChanges: true } });
  const pending = readRegistrationPendingChanges(registration.pendingChanges) ?? emptyPendingChanges();
  return savePendingChanges(registrationId, mergeRegistrationFieldChanges(pending, before, after));
}

export function registrationPendingChangeCount(pending: RegistrationPendingChanges | null) {
  if (!pending) {
    return 0;
  }
  return pending.participantAdditions.length + pending.participantRemovals.length + Object.keys(pending.fields).length;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]!));
}

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function changeSummaryRows(pending: RegistrationPendingChanges) {
  const rows: string[] = [];
  if (pending.participantAdditions.length) {
    rows.push(`Added participants: ${pending.participantAdditions.map((row) => `${row.firstName} ${row.lastName} (${row.email})`).join(", ")}`);
  }
  if (pending.participantRemovals.length) {
    rows.push(`Removed participants: ${pending.participantRemovals.map((row) => `${row.firstName} ${row.lastName} (${row.email})`).join(", ")}`);
  }
  const labels: Record<string, string> = {
    participantCount: "Participant seats",
    totalAmount: "Registration total",
    purchaseOrderNumber: "PO number",
    invoiceNumber: "Invoice number"
  };
  for (const [field, change] of Object.entries(pending.fields)) {
    const before = field === "totalAmount" ? money(change.before) : String(change.before ?? "None");
    const after = field === "totalAmount" ? money(change.after) : String(change.after ?? "None");
    rows.push(`${labels[field] ?? field}: ${before} to ${after}`);
  }
  return rows;
}

async function refreshSimpleInvoice(
  registration: Awaited<ReturnType<typeof registrationForApply>>,
  pending: RegistrationPendingChanges
) {
  const invoice = registration.invoiceDrafts[0];
  if (!invoice) {
    return null;
  }
  const amountChanged = Boolean(pending.fields.participantCount || pending.fields.totalAmount);
  if (amountChanged && invoice.lineItems.length !== 1) {
    throw Object.assign(new Error("This invoice has custom line items. Review and save the invoice before applying registration delivery changes."), {
      code: "INVOICE_REVIEW_REQUIRED",
      status: 409
    });
  }
  const lineItems = invoice.lineItems.length === 1
    ? [{
        description: invoice.lineItems[0]!.description,
        quantity: Math.max(registration.participantCount, 1),
        unitAmount: Number(registration.totalAmount) / Math.max(registration.participantCount, 1)
      }]
    : undefined;
  await updateInvoiceDraft(invoice.id, {
    cohortId: registration.cohortId,
    invoiceNumber: registration.invoiceNumber ?? undefined,
    purchaseOrderNumber: registration.purchaseOrderNumber ?? undefined,
    lineItems
  });
  return generateInvoicePdf(invoice.id, false);
}

function registrationForApply(registrationId: string) {
  return prisma.registration.findUniqueOrThrow({
    where: { id: registrationId },
    include: {
      organization: true,
      cohort: { include: { sessions: { orderBy: { startTime: "asc" }, include: { calendarEvents: { where: { provider: "google" } } } } } },
      invoiceDrafts: {
        where: { status: { notIn: [InvoiceDraftStatus.VOIDED, InvoiceDraftStatus.CANCELLED] } },
        orderBy: { updatedAt: "desc" },
        include: { lineItems: true }
      }
    }
  });
}

export async function applyRegistrationChanges(registrationId: string) {
  let registration = await registrationForApply(registrationId);
  let pending = readRegistrationPendingChanges(registration.pendingChanges);
  if (!pending || registrationPendingChangeCount(pending) === 0) {
    return { registrationId, status: "no_changes" as const };
  }
  if (!shouldDeferRegistrationDelivery(registration.cohort.status)) {
    await prisma.registration.update({ where: { id: registrationId }, data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null } });
    return { registrationId, status: "cleared_without_delivery" as const };
  }

  const invoiceRelevant = ["participantCount", "totalAmount", "purchaseOrderNumber", "invoiceNumber"].some((field) => pending?.fields[field]);
  const attendeeChanges = pending.participantAdditions.length > 0 || pending.participantRemovals.length > 0;
  let invoice = null;
  if (!pending.invoiceAppliedAt) {
    invoice = invoiceRelevant ? await refreshSimpleInvoice(registration, pending) : null;
    pending.invoiceAppliedAt = new Date().toISOString();
    await savePendingChanges(registrationId, pending);
  }

  if (!pending.participantJourneysAppliedAt) {
    if (pending.participantAdditions.length > 0) {
      const journey = await planRegistrationJourneys(registrationId, {
        syncCalendar: false,
        sendPocConfirmation: false,
        participantEmails: pending.participantAdditions.map((row) => row.email),
        retryFailed: true
      });
      if (journey.failed > 0) {
        throw Object.assign(new Error("One or more participant confirmations could not be sent. Review SendGrid safety/configuration, then apply again."), {
          code: "PARTICIPANT_CONFIRMATION_FAILED",
          status: 409
        });
      }
    }
    pending.participantJourneysAppliedAt = new Date().toISOString();
    await savePendingChanges(registrationId, pending);
  }

  if (!pending.calendarAppliedAt) {
    if (attendeeChanges) {
      for (const session of registration.cohort.sessions.filter((row) => row.startTime.getTime() > Date.now() && row.calendarEvents.some((event) => event.providerEventId))) {
        await createCalendarInvitePlaceholder(session.id, "google");
      }
    }
    pending.calendarAppliedAt = new Date().toISOString();
    await savePendingChanges(registrationId, pending);
  }

  registration = await registrationForApply(registrationId);
  pending = readRegistrationPendingChanges(registration.pendingChanges)!;
  invoice = invoice ?? (invoiceRelevant ? registration.invoiceDrafts[0] ?? null : null);
  const templates = await ensureDefaultCommunicationTemplates();
  const template = templates.find((row) => row.name === "Registration Changes Summary");
  if (!template) {
    throw Object.assign(new Error("Registration Changes Summary template is unavailable."), { code: "NOT_FOUND", status: 404 });
  }
  const rows = changeSummaryRows(pending);
  const deliveryNote = attendeeChanges
    ? "Calendar invitations and participant communications now reflect these updates."
    : "Mission Control now reflects these registration updates.";
  const summaryHtml = `<ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul><p>${deliveryNote}</p>`;
  const summaryText = `${rows.map((row) => `- ${row}`).join("\n")}\n\n${deliveryNote}`;
  const journeyKey = `registration:${registrationId}:changes:${pending.batchId}`;
  let communication = await prisma.cohortCommunication.findUnique({ where: { journeyKey } });
  if (!communication) {
    communication = await prisma.cohortCommunication.create({
      data: {
        cohortId: registration.cohortId,
        registrationId,
        templateId: template.id,
        journeyKey,
        subject: template.subject,
        bodyHtml: `${template.bodyHtml}${summaryHtml}`,
        bodyText: `${template.bodyText ?? ""}\n\n${summaryText}`,
        status: CommunicationStatus.DRAFT,
        recipientScope: RecipientScope.CUSTOM,
        recipientEmails: [registration.primaryContactEmail.toLowerCase()],
        createdById: await getSystemUserId()
      }
    });
  } else if (communication.status !== CommunicationStatus.SENT) {
    communication = await prisma.cohortCommunication.update({
      where: { id: communication.id },
      data: {
        subject: template.subject,
        bodyHtml: `${template.bodyHtml}${summaryHtml}`,
        bodyText: `${template.bodyText ?? ""}\n\n${summaryText}`,
        recipientEmails: [registration.primaryContactEmail.toLowerCase()]
      }
    });
  }

  if (invoice?.pdfFileKey && invoice.pdfUrl) {
    await prisma.communicationAttachment.deleteMany({
      where: { communicationId: communication.id, fileName: { startsWith: "Invoice " } }
    });
    const existingAttachment = await prisma.communicationAttachment.findFirst({
      where: { communicationId: communication.id, fileKey: invoice.pdfFileKey }
    });
    if (!existingAttachment) {
      await addCommunicationAttachment({
        communicationId: communication.id,
        fileName: `Invoice ${invoice.invoiceNumber ?? invoice.id}.pdf`,
        contentType: "application/pdf",
        fileKey: invoice.pdfFileKey,
        url: invoice.pdfUrl
      });
    }
  }
  if (communication.status !== CommunicationStatus.SENT) {
    communication = await sendCommunication(communication.id);
  }

  await prisma.registration.update({
    where: { id: registrationId },
    data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null }
  });
  return {
    registrationId,
    status: "applied" as const,
    changes: rows.length,
    calendarSessions: attendeeChanges
      ? registration.cohort.sessions.filter((row) => row.startTime.getTime() > Date.now() && row.calendarEvents.some((event) => event.providerEventId)).length
      : 0,
    communicationId: communication.id,
    invoiceId: invoice?.id ?? null
  };
}
