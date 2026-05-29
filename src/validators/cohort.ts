import { CohortStatus, CohortType } from "@prisma/client";
import { z } from "zod";
import {
  dateInput,
  ensureDateRange,
  ensureRegistrationWindow,
  moneyInput,
  nonNegativeIntInput,
  slugSchema
} from "@/lib/validators";

const cohortBaseSchema = z.object({
  title: z.string().min(1),
  shortName: z.string().trim().min(1).max(80).optional().or(z.literal("").transform(() => undefined)),
  slug: slugSchema,
  description: z.string().optional(),
  presenterId: z.string().min(1),
  status: z.nativeEnum(CohortStatus).optional(),
  startDate: dateInput,
  endDate: dateInput,
  registrationOpenDate: dateInput.optional(),
  registrationCloseDate: dateInput.optional(),
  defaultTimezone: z.string().min(1).default("America/New_York"),
  maxParticipants: nonNegativeIntInput.optional(),
  minParticipants: nonNegativeIntInput.optional(),
  pricePerParticipant: moneyInput.default(0),
  cohortType: z.nativeEnum(CohortType).default(CohortType.LIVE_VIRTUAL),
  thumbnailUrl: z.string().trim().optional().or(z.literal("").transform(() => undefined)).refine((value) => {
    if (!value) {
      return true;
    }

    return value.startsWith("data:image/") || z.string().url().safeParse(value).success;
  }, "Thumbnail must be an image upload or a valid URL"),
  publicRegistrationEnabled: z.boolean().default(false)
});

export const cohortCreateSchema = cohortBaseSchema
  .superRefine(ensureDateRange)
  .superRefine(ensureRegistrationWindow);

export const cohortUpdateSchema = cohortBaseSchema
  .partial()
  .superRefine(ensureDateRange)
  .superRefine(ensureRegistrationWindow);
