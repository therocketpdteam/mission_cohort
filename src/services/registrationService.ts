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
  void queueRegistrationCrmSync(registration.id, "registration.created");
  return registration;
}

export async function updateRegistration(id: string, input: z.input<typeof registrationUpdateSchema>) {
  const data = registrationUpdateSchema.parse(input);
  const registration = await prisma.registration.update({ where: { id }, data });
  void queueRegistrationCrmSync(registration.id, "registration.updated");
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
  void queueRegistrationCrmSync(registration.id, "registration.confirmed");
  return registration;
}

export async function cancelRegistration(id: string) {
  const registration = await updateRegistration(id, { status: RegistrationStatus.CANCELLED });

  if (registration.quickBooksInvoiceRef) {
    void voidRegistrationQuickBooksInvoice(registration.id).catch(() => undefined);
  }

  void queueRegistrationCrmSync(registration.id, "registration.cancelled");
  return registration;
}

export async function bulkUpdateRegistrations(input: {
  ids: string[];
  action?: "confirm" | "cancel";
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
    void queueRegistrationCrmSync(id, "registration.bulk_updated");
  }

  return { count: ids.length };
}

export async function listRegistrations(cohortId?: string) {
  return prisma.registration.findMany({
    where: cohortId ? { cohortId } : undefined,
    orderBy: { createdAt: "desc" },
    include: { cohort: true, organization: true, _count: { select: { participants: true } } }
  });
}

export async function getRegistrationById(id: string) {
  return prisma.registration.findUnique({
    where: { id },
    include: { cohort: true, organization: true, participants: true, paymentRecords: true }
  });
}
