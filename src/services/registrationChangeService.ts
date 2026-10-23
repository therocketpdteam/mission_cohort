import { randomUUID } from "node:crypto";
import {
  CohortStatus,
  CommunicationStatus,
  InvoiceDraftStatus,
  OperationsTaskCategory,
  OperationsTaskStatus,
  Prisma,
  RecipientScope,
  SupportingDocumentStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCalendarInvitePlaceholder } from "./calendarService";
import {
  addCommunicationAttachment,
  ensureDefaultCommunicationTemplates,
  getSystemUserId,
  sendCommunication
} from "./communicationService";
import { createInvoiceDraft, createSupplementalInvoice, generateInvoicePdf, updateInvoiceDraft } from "./invoiceService";
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

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const trackedRegistrationFields = [
  "participantCount",
  "totalAmount",
  "purchaseOrderNumber",
  "invoiceNumber",
  "primaryContactName",
  "primaryContactEmail",
  "primaryContactPhone",
  "primaryContactTitle",
  "billingContactName",
  "billingContactEmail"
] as const;

function looksLikeRawJotformValue(value: unknown) {
  const text = String(value ?? "");
  return (
    text.startsWith("{") ||
    text.includes("jsExecutionTracker") ||
    text.includes("validatedNewRequiredFieldIDs") ||
    /["\\]?q\d+_[a-z0-9]+["\\]?\s*:/.test(text)
  );
}

function cleanRecipientEmails(value: unknown, fallbackEmail: string) {
  const emails = Array.isArray(value) ? value.map((email) => String(email ?? "").trim().toLowerCase()) : [];
  const clean = emails.filter((email) => emailPattern.test(email) && !looksLikeRawJotformValue(email));

  return clean.length > 0 ? Array.from(new Set(clean)) : [fallbackEmail].filter(Boolean);
}

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
  if (registrationPendingChangeCount(pending) === 0) {
    return prisma.registration.update({
      where: { id: registrationId },
      data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null }
    });
  }
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

export function sentParticipantConfirmationEmails(
  communications: Array<{ status: CommunicationStatus; recipientEmails: unknown; template?: { name?: string | null } | null }>
) {
  const sent = new Set<string>();
  for (const communication of communications) {
    if (communication.status !== CommunicationStatus.SENT || communication.template?.name !== "Participant Registration Confirmation") {
      continue;
    }
    if (!Array.isArray(communication.recipientEmails)) {
      continue;
    }
    for (const value of communication.recipientEmails) {
      const email = String(value ?? "").trim().toLowerCase();
      if (emailPattern.test(email)) {
        sent.add(email);
      }
    }
  }
  return sent;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]!));
}

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function changeSummaryRows(pending: RegistrationPendingChanges) {
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
    invoiceNumber: "Invoice number",
    primaryContactName: "Primary contact name",
    primaryContactEmail: "Primary contact email",
    primaryContactPhone: "Primary contact phone",
    primaryContactTitle: "Primary contact title",
    billingContactName: "Billing contact name",
    billingContactEmail: "Billing contact email"
  };
  for (const [field, change] of Object.entries(pending.fields)) {
    const before = field === "totalAmount" ? money(change.before) : String(change.before ?? "None");
    const after = field === "totalAmount" ? money(change.after) : String(change.after ?? "None");
    rows.push(`${labels[field] ?? field}: ${before} → ${after}`);
  }
  return rows;
}

export function registrationChangeDeliveryNotes(
  pending: RegistrationPendingChanges,
  invoice?: { pdfUrl?: string | null } | null
) {
  const notes: string[] = [];
  const added = pending.participantAdditions.length > 0;
  const removed = pending.participantRemovals.length > 0;
  const invoiceChanged = ["participantCount", "totalAmount", "purchaseOrderNumber", "invoiceNumber"]
    .some((field) => Boolean(pending.fields[field]));
  const contactChanged = [
    "primaryContactName",
    "primaryContactEmail",
    "primaryContactPhone",
    "primaryContactTitle",
    "billingContactName",
    "billingContactEmail"
  ].some((field) => Boolean(pending.fields[field]));

  if (added || removed) {
    const actions = [added ? "added participants will receive cohort communications" : "", removed ? "removed participants will no longer receive future cohort communications" : ""]
      .filter(Boolean)
      .join(", and ");
    notes.push(`The participant roster and calendar attendee list have been updated. ${actions.charAt(0).toUpperCase()}${actions.slice(1)}.`);
  }
  if (invoiceChanged) {
    notes.push(invoice?.pdfUrl
      ? "An updated invoice reflecting these changes is attached. Please use this version for your records."
      : "The registration’s billing details have been updated to reflect these changes.");
  }
  if (contactChanged) {
    notes.push("Future registration and billing communications will use the updated contact information shown above.");
  }

  return notes;
}

async function refreshSimpleInvoice(
  registration: Awaited<ReturnType<typeof registrationForApply>>,
  pending: RegistrationPendingChanges
) {
  let invoice = registration.invoiceDrafts[0];
  if (!invoice) {
    const isBillable = registration.paymentMethod !== "COMPED" && Number(registration.totalAmount ?? 0) > 0;
    if (!isBillable) {
      return null;
    }
    invoice = await createInvoiceDraft({
      cohortId: registration.cohortId,
      registrationId: registration.id,
      organizationId: registration.organizationId,
      invoiceNumber: registration.invoiceNumber ?? undefined,
      purchaseOrderNumber: registration.purchaseOrderNumber ?? undefined
    });
  }
  const amountChanged = Boolean(pending.fields.participantCount || pending.fields.totalAmount);
  const protectedInvoices = registration.invoiceDrafts.filter((candidate) => {
    const matchingPaidAmount = registration.paymentRecords
      .filter((payment) => payment.status === "PAID" && payment.invoiceNumber === candidate.invoiceNumber)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    return candidate.status === InvoiceDraftStatus.PAID || Number(candidate.paidAmount) > 0 || matchingPaidAmount > 0;
  });
  if (amountChanged && protectedInvoices.length > 0) {
    const targetTotal = Number(registration.totalAmount ?? 0);
    const invoicedTotal = registration.invoiceDrafts.reduce((sum, candidate) => sum + Number(candidate.totalAmount ?? 0), 0);
    const delta = Math.round((targetTotal - invoicedTotal) * 100) / 100;
    if (delta < 0) {
      throw Object.assign(new Error(
        `The registration is ${money(Math.abs(delta))} lower than its protected invoice total. Create a credit or refund decision before applying these changes.`
      ), { code: "INVOICE_CREDIT_REVIEW_REQUIRED", status: 409 });
    }
    if (delta > 0) {
      const oldestInvoice = [...registration.invoiceDrafts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const baseInvoiceNumber = oldestInvoice?.invoiceNumber ?? registration.invoiceNumber;
      if (!baseInvoiceNumber) {
        throw Object.assign(new Error("The paid invoice does not have an invoice number. Add one before creating a supplemental invoice."), {
          code: "INVOICE_REVIEW_REQUIRED",
          status: 409
        });
      }
      const beforeSeats = Number(pending.fields.participantCount?.before ?? registration.participantCount);
      const addedSeats = Math.max(registration.participantCount - beforeSeats, 1);
      return createSupplementalInvoice({
        registrationId: registration.id,
        amount: delta,
        quantity: addedSeats,
        baseInvoiceNumber,
        description: `Additional seats for ${registration.cohort.title}`
      });
    }
    return invoice;
  }
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
      },
      paymentRecords: true
    }
  });
}

export async function applyRegistrationChanges(registrationId: string) {
  let registration = await registrationForApply(registrationId);
  let pending = readRegistrationPendingChanges(registration.pendingChanges);
  if (!pending || registrationPendingChangeCount(pending) === 0) {
    if (registration.pendingChanges || registration.pendingChangesAt) {
      await prisma.registration.update({ where: { id: registrationId }, data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null } });
    }
    return { registrationId, status: "no_changes" as const };
  }
  if (!shouldDeferRegistrationDelivery(registration.cohort.status)) {
    await prisma.registration.update({ where: { id: registrationId }, data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null } });
    return { registrationId, status: "cleared_without_delivery" as const };
  }

  const invoiceRelevant = ["participantCount", "totalAmount", "purchaseOrderNumber", "invoiceNumber"].some((field) => pending?.fields[field]);
  const attendeeChanges = pending.participantAdditions.length > 0 || pending.participantRemovals.length > 0;
  if (pending.participantAdditions.length > 0 && pending.participantRemovals.length === 0 && Object.keys(pending.fields).length === 0) {
    const sentConfirmations = sentParticipantConfirmationEmails(await prisma.cohortCommunication.findMany({
      where: {
        registrationId,
        status: CommunicationStatus.SENT,
        template: { name: "Participant Registration Confirmation" }
      },
      select: { status: true, recipientEmails: true, template: { select: { name: true } } }
    }));
    const alreadyDelivered = pending.participantAdditions.every((participant) => sentConfirmations.has(participant.email.trim().toLowerCase()));
    if (alreadyDelivered) {
      throw Object.assign(new Error(
        "These participant additions already have sent confirmations. Apply was stopped to prevent duplicate client communication. Use the controlled stale-change reconciliation after verifying calendar enrollment."
      ), { code: "STALE_DELIVERY_REVIEW_REQUIRED", status: 409 });
    }
  }
  const calendarIssues: Array<{ sessionId: string; title: string; error: string }> = [];
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
      const futureSessions = registration.cohort.sessions.filter((row) => row.startTime.getTime() > Date.now());
      const linkedSessions = futureSessions.filter((row) => row.calendarEvents.some((event) => event.providerEventId));
      if (futureSessions.length > 0 && linkedSessions.length !== futureSessions.length) {
        calendarIssues.push({
          sessionId: "unlinked",
          title: "Future cohort sessions",
          error: `${futureSessions.length - linkedSessions.length} future session(s) do not have a linked Google Calendar event.`
        });
      }

      for (const session of linkedSessions) {
        try {
          await createCalendarInvitePlaceholder(session.id, "google", { sendUpdates: false });
        } catch (error) {
          calendarIssues.push({
            sessionId: session.id,
            title: session.title,
            error: error instanceof Error ? error.message : "Google Calendar update failed"
          });
        }
      }
    }

    if (calendarIssues.length > 0) {
      const description = [
        `Registration changes remain pending because calendar enrollment failed for ${calendarIssues.length} item(s).`,
        `First error: ${calendarIssues[0].error}`,
        "Restore Google Calendar connectivity, then apply the registration changes again. No success summary was sent."
      ].join(" ");
      const existingTask = await prisma.operationsTask.findFirst({
        where: {
          registrationId,
          category: OperationsTaskCategory.CALENDAR_INVITE,
          status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
        }
      });
      if (existingTask) {
        await prisma.operationsTask.update({
          where: { id: existingTask.id },
          data: { status: OperationsTaskStatus.OPEN, priority: "URGENT", description, completedAt: null }
        });
      } else {
        await prisma.operationsTask.create({
          data: {
            cohortId: registration.cohortId,
            registrationId,
            title: `Verify calendar invites for ${registration.primaryContactEmail}`,
            description,
            category: OperationsTaskCategory.CALENDAR_INVITE,
            priority: "URGENT",
            status: OperationsTaskStatus.OPEN
          }
        });
      }
      await savePendingChanges(registrationId, pending);
      throw Object.assign(new Error(description), { code: "CALENDAR_UPDATE_FAILED", status: 409, calendarIssues });
    }

    pending.calendarAppliedAt = new Date().toISOString();
    await savePendingChanges(registrationId, pending);
  }

  if (attendeeChanges && calendarIssues.length === 0) {
    await prisma.operationsTask.updateMany({
      where: {
        registrationId,
        category: OperationsTaskCategory.CALENDAR_INVITE,
        status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
      },
      data: {
        status: OperationsTaskStatus.COMPLETED,
        completedAt: new Date(),
        description: "Calendar enrollment verified after registration changes were applied."
      }
    });
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
  if (invoice?.invoiceNumber && /-[A-Z]$/i.test(invoice.invoiceNumber)) {
    rows.push(`Supplemental invoice ${invoice.invoiceNumber}: ${money(invoice.totalAmount)} for the added balance only. The original paid invoice remains unchanged.`);
  }
  const deliveryNotes = registrationChangeDeliveryNotes(pending, invoice);
  const summaryHtml = [
    "<p>Hello {{registration.primaryContactFirstName}},</p>",
    "<p>We’ve completed the requested updates to your registration for <strong>{{cohort.title}}</strong>.</p>",
    "<p>Here’s what changed:</p>",
    `<ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`,
    ...deliveryNotes.map((note) => `<p>${escapeHtml(note)}</p>`),
    "<p>Questions? Reply to this message or contact <a href=\"mailto:info@rocketpd.com\">info@rocketpd.com</a>.</p>",
    "<p>The RocketPD Team</p>"
  ].join("");
  const summaryText = [
    "Hello {{registration.primaryContactFirstName}},",
    "",
    "We’ve completed the requested updates to your registration for {{cohort.title}}.",
    "",
    "Here’s what changed:",
    ...rows.map((row) => `- ${row}`),
    "",
    ...deliveryNotes.flatMap((note) => [note, ""]),
    "Questions? Reply to this message or contact info@rocketpd.com.",
    "",
    "The RocketPD Team"
  ].join("\n");
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
        bodyHtml: summaryHtml,
        bodyText: summaryText,
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
        bodyHtml: summaryHtml,
        bodyText: summaryText,
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

  if (invoice?.pdfUrl) {
    await prisma.$transaction([
      prisma.invoiceDraft.updateMany({
        where: { id: invoice.id, status: InvoiceDraftStatus.DRAFT },
        data: { status: InvoiceDraftStatus.SENT }
      }),
      prisma.registration.update({
        where: { id: registrationId },
        data: {
          invoiceUrl: invoice.pdfUrl,
          confirmationDocsSentAt: new Date(),
          supportingDocumentStatus: SupportingDocumentStatus.SENT
        }
      })
    ]);
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
    calendarIssues,
    communicationId: communication.id,
    invoiceId: invoice?.id ?? null
  };
}

export async function discardRegistrationChanges(registrationId: string) {
  const registration = await prisma.registration.findUniqueOrThrow({
    where: { id: registrationId },
    select: {
      primaryContactEmail: true,
      participants: { select: { id: true, email: true } },
      communications: {
        select: {
          id: true,
          participantId: true,
          journeyKey: true,
          recipientEmails: true,
          status: true
        }
      }
    }
  });
  const participantEmailById = new Map(registration.participants.map((participant) => [participant.id, participant.email.toLowerCase()]));
  let sanitizedCommunications = 0;

  for (const communication of registration.communications) {
    const rawRecipient = looksLikeRawJotformValue(JSON.stringify(communication.recipientEmails ?? []));
    const rawJourneyKey = looksLikeRawJotformValue(communication.journeyKey ?? "");

    if (!rawRecipient && !rawJourneyKey) {
      continue;
    }

    const fallbackEmail = communication.participantId
      ? participantEmailById.get(communication.participantId) ?? registration.primaryContactEmail.toLowerCase()
      : registration.primaryContactEmail.toLowerCase();

    await prisma.cohortCommunication.update({
      where: { id: communication.id },
      data: {
        recipientEmails: cleanRecipientEmails(communication.recipientEmails, fallbackEmail),
        journeyKey: rawJourneyKey ? null : communication.journeyKey,
        providerError: communication.status === CommunicationStatus.CANCELLED
          ? "Cancelled after participant contact data was corrected."
          : undefined
      }
    });
    sanitizedCommunications += 1;
  }

  await prisma.registration.update({
    where: { id: registrationId },
    data: { pendingChanges: Prisma.JsonNull, pendingChangesAt: null }
  });

  return { registrationId, status: "discarded" as const, sanitizedCommunications };
}
