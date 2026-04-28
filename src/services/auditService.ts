import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuditInput = {
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function logAuditEvent(input: AuditInput) {
  try {
    return await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        description: input.description,
        metadata: input.metadata
      }
    });
  } catch (error) {
    console.error("Audit logging failed", error);
    return null;
  }
}

export function logAuditEventAsync(input: AuditInput) {
  void logAuditEvent(input);
}

export async function listAuditEventsForEntity(entityType: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" }
  });
}
