import { z } from "zod";

const jotformFormMappingBaseSchema = z.object({
  formId: z.string().min(1),
  label: z.string().min(1),
  sessionCount: z.coerce.number().int().positive(),
  defaultCohortId: z.preprocess(
    (value) => value === "" || value === null ? undefined : value,
    z.string().min(1).optional()
  ),
  requireCohortSlug: z.boolean().default(false),
  active: z.boolean().default(true)
});

export const jotformFormMappingCreateSchema = jotformFormMappingBaseSchema.superRefine((value, context) => {
  if (!value.requireCohortSlug && !value.defaultCohortId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultCohortId"],
      message: "Default cohort is required unless cohortSlug is required"
    });
  }
});

export const jotformFormMappingUpdateSchema = jotformFormMappingBaseSchema.partial().superRefine((value, context) => {
  if (value.requireCohortSlug === false && value.defaultCohortId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultCohortId"],
      message: "Default cohort is required unless cohortSlug is required"
    });
  }
});
