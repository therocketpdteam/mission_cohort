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
  fieldMapJson: z.record(z.string()).optional(),
  active: z.boolean().default(true)
});

function hasLandingPageRoutes(fieldMapJson?: Record<string, string>) {
  if (!fieldMapJson?.__landingPageRoutes) {
    return false;
  }

  try {
    const routes = JSON.parse(fieldMapJson.__landingPageRoutes);
    return Array.isArray(routes) && routes.some((route) => route?.pattern && route?.cohortId);
  } catch {
    return false;
  }
}

export const jotformFormMappingCreateSchema = jotformFormMappingBaseSchema.superRefine((value, context) => {
  if (!value.requireCohortSlug && !value.defaultCohortId && !hasLandingPageRoutes(value.fieldMapJson)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultCohortId"],
      message: "Default cohort, cohortSlug routing, or landing page URL routing is required"
    });
  }
});

export const jotformFormMappingUpdateSchema = jotformFormMappingBaseSchema.partial().superRefine((value, context) => {
  if (value.requireCohortSlug === false && value.defaultCohortId === undefined && !hasLandingPageRoutes(value.fieldMapJson)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultCohortId"],
      message: "Default cohort, cohortSlug routing, or landing page URL routing is required"
    });
  }
});
