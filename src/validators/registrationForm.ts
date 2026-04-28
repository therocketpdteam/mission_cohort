import { z } from "zod";
import { slugSchema } from "@/lib/validators";

export const registrationFormCreateSchema = z.object({
  cohortId: z.string().min(1),
  title: z.string().min(1),
  slug: slugSchema,
  active: z.boolean().default(true),
  formConfigJson: z.record(z.unknown()).default({ fields: [] }),
  successMessage: z.string().optional(),
  webhookEnabled: z.boolean().default(false)
});

export const registrationFormUpdateSchema = registrationFormCreateSchema.omit({ cohortId: true }).partial();
