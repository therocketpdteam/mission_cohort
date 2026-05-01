import { RegistrationStatus } from "@prisma/client";
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
