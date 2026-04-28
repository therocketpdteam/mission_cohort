import { CommunicationStatus, RecipientScope, TemplateType } from "@prisma/client";
import { z } from "zod";
import { dateInput } from "@/lib/validators";

export const communicationTemplateCreateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  type: z.nativeEnum(TemplateType),
  active: z.boolean().default(true)
});

export const communicationTemplateUpdateSchema = communicationTemplateCreateSchema.partial();

export const communicationDraftCreateSchema = z.object({
  cohortId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  scheduledFor: dateInput.optional(),
  status: z.nativeEnum(CommunicationStatus).default(CommunicationStatus.DRAFT),
  recipientScope: z.nativeEnum(RecipientScope),
  createdById: z.string().min(1)
});

export const communicationScheduleSchema = z.object({
  communicationId: z.string().min(1),
  scheduledFor: dateInput
});
