import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  registrationFormCreateSchema,
  registrationFormUpdateSchema
} from "@/validators/registrationForm";
import { logAuditEventAsync } from "./auditService";

export async function createRegistrationForm(input: z.input<typeof registrationFormCreateSchema>) {
  const data = registrationFormCreateSchema.parse(input);
  const form = await prisma.registrationForm.create({ data });
  logAuditEventAsync({
    entityType: "RegistrationForm",
    entityId: form.id,
    action: "CREATED",
    description: "Registration form created",
    metadata: { cohortId: form.cohortId, slug: form.slug }
  });
  return form;
}

export async function updateRegistrationForm(id: string, input: z.input<typeof registrationFormUpdateSchema>) {
  const data = registrationFormUpdateSchema.parse(input);
  return prisma.registrationForm.update({ where: { id }, data });
}

export async function getRegistrationFormBySlug(slug: string) {
  return prisma.registrationForm.findUnique({
    where: { slug },
    include: { cohort: true }
  });
}

export async function listFormsByCohort(cohortId: string) {
  return prisma.registrationForm.findMany({
    where: { cohortId },
    orderBy: { createdAt: "desc" }
  });
}
