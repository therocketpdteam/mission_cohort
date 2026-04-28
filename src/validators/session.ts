import { CalendarInviteStatus } from "@prisma/client";
import { z } from "zod";
import { dateInput, ensureEndAfterStart, positiveIntInput } from "@/lib/validators";

const sessionBaseSchema = z.object({
  cohortId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  sessionNumber: positiveIntInput,
  startTime: dateInput,
  endTime: dateInput,
  timezone: z.string().min(1),
  meetingUrl: z.string().url().optional(),
  location: z.string().optional(),
  calendarInviteStatus: z.nativeEnum(CalendarInviteStatus).optional(),
  recordingUrl: z.string().url().optional(),
  slidesUrl: z.string().url().optional(),
  resourcesUrl: z.string().url().optional()
});

export const sessionCreateSchema = sessionBaseSchema.superRefine(ensureEndAfterStart);

export const sessionUpdateSchema = sessionBaseSchema
  .omit({ cohortId: true })
  .partial()
  .superRefine(ensureEndAfterStart);
