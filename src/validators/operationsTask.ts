import { OperationsTaskCategory, OperationsTaskPriority, OperationsTaskStatus } from "@prisma/client";
import { z } from "zod";
import { optionalDateInput } from "@/lib/validators";

export const operationsTaskCreateSchema = z.object({
  cohortId: z.string().min(1).optional(),
  registrationId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.nativeEnum(OperationsTaskCategory),
  status: z.nativeEnum(OperationsTaskStatus).default(OperationsTaskStatus.OPEN),
  priority: z.nativeEnum(OperationsTaskPriority).default(OperationsTaskPriority.MEDIUM),
  dueDate: optionalDateInput,
  ownerName: z.string().optional()
});

export const operationsTaskUpdateSchema = operationsTaskCreateSchema.partial().extend({
  completedAt: optionalDateInput
});
