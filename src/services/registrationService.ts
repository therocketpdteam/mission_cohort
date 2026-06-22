import { ParticipantListStatus, PaymentStatus, RegistrationStatus, SupportingDocumentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { shouldDefaultPrimaryContactParticipant } from "@/lib/rosterStatus";
import { registrationCreateSchema, registrationUpdateSchema } from "@/validators/registration";
import { logAuditEventAsync } from "./auditService";
import { createDefaultRegistrationOperationsTasks } from "./operationsTaskService";
import { queueParticipantCrmSync, queueRegistrationCrmSync } from "./crmSyncService";
import { voidRegistrationQuickBooksInvoice } from "./quickBooksService";
import { cancelRegistrationJourneys, planRegistrationJourneys } from "./registrationJourneyService";
import { syncRegistrationParticipantListStatus } from "./participantService";

function splitPrimaryContactName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "Participant",
    lastName: parts.length > 1 ? parts.at(-1)! : "-"
  };
}

async function ensureSingleSeatPrimaryContactParticipant(registration: {
  id: string;
  cohortId: string;
  organizationId: string;
  participantCount: number;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string | null;
  primaryContactTitle: string | null;
}, inheritedSingleSeatDefault = false) {
  const actualCount = await prisma.participant.count({ where: { registrationId: registration.id } });
  if (!shouldDefaultPrimaryContactParticipant(registration.participantCount, actualCount) && !(inheritedSingleSeatDefault && actualCount === 0)) {
    return null;
  }

  const name = splitPrimaryContactName(registration.primaryContactName);
  const participant = await prisma.participant.create({
    data: {
      registrationId: registration.id,
      cohortId: registration.cohortId,
      organizationId: registration.organizationId,
      firstName: name.firstName,
      lastName: name.lastName,
      email: registration.primaryContactEmail.toLowerCase(),
      phone: registration.primaryContactPhone ?? undefined,
      title: registration.primaryContactTitle ?? undefined
    }
  });
  logAuditEventAsync({
    entityType: "Participant",
    entityId: participant.id,
    action: "ADDED",
    description: "Primary contact defaulted to participant for a one-seat registration",
    metadata: { registrationId: registration.id, cohortId: registration.cohortId }
  });
  void queueParticipantCrmSync(participant.id, "participant.created").catch(() => undefined);
  return { participant, created: true };
}

export async function createRegistration(input: z.input<typeof registrationCreateSchema>) {
  const data = registrationCreateSchema.parse(input);
  const registration = await prisma.registration.create({ data });
  await ensureSingleSeatPrimaryContactParticipant(registration);
  const roster = await syncRegistrationParticipantListStatus(registration.id);
  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "CREATED",
    description: "Registration created",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId }
  });
  void createDefaultRegistrationOperationsTasks({
    cohortId: registration.cohortId,
    registrationId: registration.id,
    participantCount: registration.participantCount,
    actualParticipantCount: roster?.actualCount ?? 0,
    paymentStatus: registration.paymentStatus,
    hasSupportingDocs: Boolean(registration.w9Url || registration.invoiceUrl || registration.confirmationDocsSentAt)
  });
  void queueRegistrationCrmSync(registration.id, "registration.created").catch(() => undefined);
  const journey = await planRegistrationJourneys(registration.id);
  return { ...registration, participantListStatus: roster?.status ?? registration.participantListStatus, journey };
}

export async function updateRegistration(id: string, input: z.input<typeof registrationUpdateSchema>) {
  const data = registrationUpdateSchema.parse(input);
  const previous = await prisma.registration.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { participants: true } } }
  });
  const registration = await prisma.registration.update({ where: { id }, data });
  await ensureSingleSeatPrimaryContactParticipant(
    registration,
    previous.participantCount === 1 && previous._count.participants === 0
  );
  const roster = await syncRegistrationParticipantListStatus(registration.id);
  void queueRegistrationCrmSync(registration.id, "registration.updated").catch(() => undefined);
  const journey = registration.status === RegistrationStatus.CANCELLED
    ? await cancelRegistrationJourneys(registration.id, "Registration cancelled.")
    : await planRegistrationJourneys(registration.id);
  return { ...registration, participantListStatus: roster?.status ?? registration.participantListStatus, journey };
}

export async function confirmRegistration(id: string) {
  const registration = await updateRegistration(id, { status: RegistrationStatus.CONFIRMED });
  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "CONFIRMED",
    description: "Registration confirmed"
  });
  void queueRegistrationCrmSync(registration.id, "registration.confirmed").catch(() => undefined);
  return registration;
}

export async function cancelRegistration(id: string) {
  const registration = await updateRegistration(id, { status: RegistrationStatus.CANCELLED });

  if (registration.quickBooksInvoiceRef) {
    void voidRegistrationQuickBooksInvoice(registration.id).catch(() => undefined);
  }

  void queueRegistrationCrmSync(registration.id, "registration.cancelled").catch(() => undefined);
  return registration;
}

export async function archiveRegistration(id: string, reason?: string) {
  const registration = await prisma.registration.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      archivedReason: reason?.trim() || undefined
    }
  });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "ARCHIVED",
    description: "Registration archived",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId, reason: reason ?? null }
  });
  void queueRegistrationCrmSync(registration.id, "registration.archived").catch(() => undefined);
  await cancelRegistrationJourneys(registration.id, reason?.trim() || "Registration archived.");
  return registration;
}

export async function restoreRegistration(id: string) {
  const registration = await prisma.registration.update({
    where: { id },
    data: {
      archivedAt: null,
      archivedReason: null
    }
  });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "RESTORED",
    description: "Registration restored from archive",
    metadata: { cohortId: registration.cohortId, organizationId: registration.organizationId }
  });
  void queueRegistrationCrmSync(registration.id, "registration.restored").catch(() => undefined);
  const journey = await planRegistrationJourneys(registration.id);
  return { ...registration, journey };
}

export async function deleteRegistration(id: string) {
  const registration = await prisma.registration.findUnique({
    where: { id },
    include: {
      invoiceDrafts: true,
      paymentRecords: true,
      _count: { select: { participants: true, operationsTasks: true, webhookEvents: true } }
    }
  });

  if (!registration) {
    throw Object.assign(new Error("Registration not found"), { code: "NOT_FOUND", status: 404 });
  }

  const hasQuickBooksReference = Boolean(
    registration.quickBooksCustomerRef ||
      registration.quickBooksInvoiceRef ||
      registration.quickBooksRealmId ||
      registration.paymentRecords.some((payment) => payment.quickBooksInvoiceRef || payment.quickBooksPaymentRef || payment.quickBooksRealmId) ||
      registration.invoiceDrafts.some((invoice) => invoice.quickBooksInvoiceRef || invoice.quickBooksCustomerRef || invoice.quickBooksRealmId)
  );

  if (hasQuickBooksReference) {
    throw Object.assign(new Error("This registration has QuickBooks references. Archive it instead, or void/detach the finance records before permanent deletion."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  if (registration.invoiceDrafts.length > 0) {
    throw Object.assign(new Error("This registration has invoice drafts. Archive it instead, or remove the invoice drafts before permanent deletion."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  await cancelRegistrationJourneys(id, "Registration permanently deleted.");
  await prisma.registration.delete({ where: { id } });

  logAuditEventAsync({
    entityType: "Registration",
    entityId: id,
    action: "DELETED",
    description: "Registration permanently deleted",
    metadata: {
      cohortId: registration.cohortId,
      organizationId: registration.organizationId,
      participants: registration._count.participants,
      paymentRecords: registration.paymentRecords.length,
      invoiceDrafts: registration.invoiceDrafts.length,
      operationsTasks: registration._count.operationsTasks,
      webhookEventsDetached: registration._count.webhookEvents
    }
  });

  return { id, deleted: true };
}

export async function bulkUpdateRegistrations(input: {
  ids: string[];
  action?: "confirm" | "cancel" | "archive" | "restore";
  paymentStatus?: PaymentStatus;
  participantListStatus?: ParticipantListStatus;
  supportingDocumentStatus?: SupportingDocumentStatus;
}) {
  const ids = input.ids.filter(Boolean);

  if (ids.length === 0) {
    return { count: 0 };
  }

  if (input.action === "confirm") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { status: RegistrationStatus.CONFIRMED } });
  } else if (input.action === "cancel") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { status: RegistrationStatus.CANCELLED } });
  } else if (input.action === "archive") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
  } else if (input.action === "restore") {
    await prisma.registration.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null, archivedReason: null } });
  } else {
    const data: {
      paymentStatus?: PaymentStatus;
      participantListStatus?: ParticipantListStatus;
      supportingDocumentStatus?: SupportingDocumentStatus;
    } = {};

    if (input.paymentStatus) {
      data.paymentStatus = input.paymentStatus;
    }

    if (input.participantListStatus) {
      data.participantListStatus = input.participantListStatus;
    }

    if (input.supportingDocumentStatus) {
      data.supportingDocumentStatus = input.supportingDocumentStatus;
    }

    await prisma.registration.updateMany({ where: { id: { in: ids } }, data });

    if (input.paymentStatus) {
      await prisma.paymentRecord.updateMany({
        where: { registrationId: { in: ids } },
        data: { status: input.paymentStatus }
      });
    }
  }

  for (const id of ids) {
    void queueRegistrationCrmSync(id, "registration.bulk_updated").catch(() => undefined);
    if (input.action === "cancel" || input.action === "archive") {
      await cancelRegistrationJourneys(id, input.action === "cancel" ? "Registration cancelled." : "Registration archived.");
    } else if (input.action === "restore") {
      await planRegistrationJourneys(id);
    }
  }

  return { count: ids.length };
}

export async function listRegistrations(cohortId?: string, options: { includeArchived?: boolean } = {}) {
  return prisma.registration.findMany({
    where: {
      ...(cohortId ? { cohortId } : {}),
      ...(options.includeArchived ? {} : { archivedAt: null })
    },
    orderBy: { createdAt: "desc" },
    include: { cohort: true, organization: true, _count: { select: { participants: true } } }
  });
}

export async function getRegistrationById(id: string) {
  return prisma.registration.findUnique({
    where: { id },
    include: {
      cohort: true,
      organization: true,
      participants: true,
      paymentRecords: true,
      operationsTasks: {
        orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }]
      },
      webhookEvents: {
        where: { source: "jotform" },
        orderBy: { createdAt: "desc" },
        take: 12
      },
      communications: {
        orderBy: { createdAt: "desc" },
        include: {
          participant: true,
          template: true,
          emailEvents: { orderBy: { createdAt: "desc" } },
          attachments: true
        }
      }
    }
  });
}
