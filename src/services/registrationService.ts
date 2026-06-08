import { ParticipantListStatus, PaymentStatus, RegistrationStatus, SupportingDocumentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { registrationCreateSchema, registrationUpdateSchema } from "@/validators/registration";
import { logAuditEventAsync } from "./auditService";
import { createDefaultRegistrationOperationsTasks } from "./operationsTaskService";
import { queueRegistrationCrmSync } from "./crmSyncService";
import { voidRegistrationQuickBooksInvoice } from "./quickBooksService";

export async function createRegistration(input: z.input<typeof registrationCreateSchema>) {
  const data = registrationCreateSchema.parse(input);
  const registration = await prisma.registration.create({ data });
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
    actualParticipantCount: 0,
    paymentStatus: registration.paymentStatus,
    hasSupportingDocs: Boolean(registration.w9Url || registration.invoiceUrl || registration.confirmationDocsSentAt)
  });
  void queueRegistrationCrmSync(registration.id, "registration.created").catch(() => undefined);
  return registration;
}

export async function updateRegistration(id: string, input: z.input<typeof registrationUpdateSchema>) {
  const data = registrationUpdateSchema.parse(input);
  const registration = await prisma.registration.update({ where: { id }, data });
  void queueRegistrationCrmSync(registration.id, "registration.updated").catch(() => undefined);
  return registration;
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
  return registration;
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
      }
    }
  });
}
