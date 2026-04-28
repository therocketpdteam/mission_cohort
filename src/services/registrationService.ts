import { RegistrationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { registrationCreateSchema, registrationUpdateSchema } from "@/validators/registration";
import { logAuditEventAsync } from "./auditService";

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
  return registration;
}

export async function updateRegistration(id: string, input: z.input<typeof registrationUpdateSchema>) {
  const data = registrationUpdateSchema.parse(input);
  return prisma.registration.update({ where: { id }, data });
}

export async function confirmRegistration(id: string) {
  const registration = await updateRegistration(id, { status: RegistrationStatus.CONFIRMED });
  logAuditEventAsync({
    entityType: "Registration",
    entityId: registration.id,
    action: "CONFIRMED",
    description: "Registration confirmed"
  });
  return registration;
}

export async function cancelRegistration(id: string) {
  return updateRegistration(id, { status: RegistrationStatus.CANCELLED });
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
