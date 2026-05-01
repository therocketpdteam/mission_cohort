import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { organizationCreateSchema, organizationUpdateSchema } from "@/validators/organization";
import { queueCrmSyncEvent } from "./crmSyncService";

export async function createOrganization(input: z.input<typeof organizationCreateSchema>) {
  const data = organizationCreateSchema.parse(input);
  const organization = await prisma.organization.create({ data });
  void queueCrmSyncEvent({
    eventType: "organization.created",
    entityType: "Organization",
    entityId: organization.id,
    organizationId: organization.id,
    payload: {
      missionControlId: organization.id,
      name: organization.name,
      type: organization.type,
      website: organization.website,
      city: organization.city,
      state: organization.state
    }
  });
  return organization;
}

export async function updateOrganization(id: string, input: z.input<typeof organizationUpdateSchema>) {
  const data = organizationUpdateSchema.parse(input);
  const organization = await prisma.organization.update({ where: { id }, data });
  void queueCrmSyncEvent({
    eventType: "organization.updated",
    entityType: "Organization",
    entityId: organization.id,
    organizationId: organization.id,
    payload: {
      missionControlId: organization.id,
      name: organization.name,
      type: organization.type,
      website: organization.website,
      city: organization.city,
      state: organization.state
    }
  });
  return organization;
}

export async function listOrganizations() {
  return prisma.organization.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { registrations: true, participants: true } } }
  });
}

export async function getOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: { registrations: true, participants: true, paymentRecords: true }
  });
}
