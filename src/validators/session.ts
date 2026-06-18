import { CalendarInviteStatus } from "@prisma/client";
import { z } from "zod";
import { dateInput, ensureEndAfterStart, optionalString, optionalUrl, positiveIntInput } from "@/lib/validators";

const sessionBaseSchema = z.object({
  cohortId: z.string().min(1),
  title: z.string().min(1),
  description: optionalString,
  sessionNumber: positiveIntInput,
  startTime: dateInput,
  endTime: dateInput,
  timezone: z.string().min(1),
  meetingUrl: optionalUrl,
  location: optionalString,
  calendarInviteStatus: z.nativeEnum(CalendarInviteStatus).optional(),
  recordingUrl: optionalUrl,
  slidesUrl: optionalUrl,
  resourcesUrl: optionalUrl
});

export const sessionCreateSchema = sessionBaseSchema.superRefine(ensureEndAfterStart);

export const sessionUpdateSchema = sessionBaseSchema
  .omit({ cohortId: true })
  .partial()
  .superRefine(ensureEndAfterStart);
