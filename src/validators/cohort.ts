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
  thumbnailUrl: z.string().url().optional(),
  publicRegistrationEnabled: z.boolean().default(false)
});

export const cohortCreateSchema = cohortBaseSchema
  .superRefine(ensureDateRange)
  .superRefine(ensureRegistrationWindow);

export const cohortUpdateSchema = cohortBaseSchema
  .partial()
  .superRefine(ensureDateRange)
  .superRefine(ensureRegistrationWindow);
