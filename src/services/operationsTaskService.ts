import { OperationsTaskCategory, OperationsTaskPriority, OperationsTaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { operationsTaskCreateSchema, operationsTaskUpdateSchema } from "@/validators/operationsTask";
import { logAuditEventAsync } from "./auditService";

export async function createOperationsTask(input: z.input<typeof operationsTaskCreateSchema>) {
  const data = operationsTaskCreateSchema.parse(input);
  const task = await prisma.operationsTask.create({ data });

  logAuditEventAsync({
    entityType: "OperationsTask",
    entityId: task.id,
    action: "CREATED",
    description: "Operations task created",
    metadata: {
      cohortId: task.cohortId ?? null,
      registrationId: task.registrationId ?? null,
      sessionId: task.sessionId ?? null,
      category: task.category
    }
  });

  return task;
}

export async function updateOperationsTask(id: string, input: z.input<typeof operationsTaskUpdateSchema>) {
  const data = operationsTaskUpdateSchema.parse(input);
  return prisma.operationsTask.update({ where: { id }, data });
}

export async function completeOperationsTask(id: string) {
  const task = await prisma.operationsTask.update({
    where: { id },
    data: {
      status: OperationsTaskStatus.COMPLETED,
      completedAt: new Date()
    }
  });

  logAuditEventAsync({
    entityType: "OperationsTask",
    entityId: task.id,
    action: "COMPLETED",
    description: "Operations task completed",
    metadata: { cohortId: task.cohortId ?? null, registrationId: task.registrationId ?? null }
  });

  return task;
}

export async function listTasksForCohort(cohortId: string) {
  return prisma.operationsTask.findMany({
    where: { cohortId },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: { registration: true, session: true }
  });
}

export async function listOpenOperationsTasks(limit = 20) {
  return prisma.operationsTask.findMany({
    where: { status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] } },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: limit,
    include: { cohort: true, registration: true, session: true }
  });
}

export async function createDefaultRegistrationOperationsTasks(input: {
  cohortId: string;
  registrationId: string;
  participantCount: number;
  actualParticipantCount: number;
  paymentStatus: string;
  hasSupportingDocs: boolean;
}) {
  const tasks: Array<z.input<typeof operationsTaskCreateSchema>> = [];

  if (input.participantCount > input.actualParticipantCount) {
    tasks.push({
      cohortId: input.cohortId,
      registrationId: input.registrationId,
      title: "Collect participant list",
      description: "Registration was received without a complete participant roster.",
      category: OperationsTaskCategory.PARTICIPANT_LIST,
      priority: OperationsTaskPriority.HIGH
    });
  }

  if (["PENDING", "INVOICED", "PARTIALLY_PAID"].includes(input.paymentStatus)) {
    tasks.push({
      cohortId: input.cohortId,
      registrationId: input.registrationId,
      title: "Follow up on payment status",
      description: "Review invoice, purchase order, or QuickBooks reference for this registration.",
      category: OperationsTaskCategory.PAYMENT_FOLLOW_UP,
      priority: OperationsTaskPriority.MEDIUM
    });
  }

  if (!input.hasSupportingDocs) {
    tasks.push({
      cohortId: input.cohortId,
      registrationId: input.registrationId,
      title: "Send supporting documents",
      description: "Attach or confirm W-9 and invoice links for the registration confirmation workflow.",
      category: OperationsTaskCategory.SUPPORTING_DOCUMENTS,
      priority: OperationsTaskPriority.MEDIUM
    });
  }

  return Promise.all(tasks.map((task) => createOperationsTask(task)));
}

export async function createDefaultSessionOperationsTasks(input: {
  cohortId: string;
  sessionId: string;
  sessionTitle: string;
}) {
  const tasks: Array<z.input<typeof operationsTaskCreateSchema>> = [
    {
      cohortId: input.cohortId,
      sessionId: input.sessionId,
      title: `Create calendar invite for ${input.sessionTitle}`,
      description: "Confirm Google Calendar or ICS invite details before sending to participants.",
      category: OperationsTaskCategory.CALENDAR_INVITE,
      priority: OperationsTaskPriority.HIGH
    },
    {
      cohortId: input.cohortId,
      sessionId: input.sessionId,
      title: `Schedule reminders for ${input.sessionTitle}`,
      description: "Plan 7-day, 24-hour, and 1-hour reminder communications for this session.",
      category: OperationsTaskCategory.REMINDER_EMAILS,
      priority: OperationsTaskPriority.MEDIUM
    },
    {
      cohortId: input.cohortId,
      sessionId: input.sessionId,
      title: `Prepare resources for ${input.sessionTitle}`,
      description: "Confirm slides, resources, and any post-session recording links for delivery.",
      category: OperationsTaskCategory.SESSION_RESOURCES,
      priority: OperationsTaskPriority.MEDIUM
    }
  ];

  return Promise.all(tasks.map((task) => createOperationsTask(task)));
}
