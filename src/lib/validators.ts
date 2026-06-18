import { z } from "zod";

export const idSchema = z.string().min(1);
export const slugSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL-safe slug");

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const dateInput = z.coerce.date();
export const optionalDateInput = z.preprocess(emptyToUndefined, z.coerce.date().optional());
export const moneyInput = z.coerce.number().min(0);
export const positiveIntInput = z.coerce.number().int().positive();
export const nonNegativeIntInput = z.coerce.number().int().min(0);

export const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

export const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());

export const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

export function ensureEndAfterStart<T extends { startTime?: Date; endTime?: Date }>(
  value: T,
  context: z.RefinementCtx
) {
  if (value.startTime && value.endTime && value.endTime <= value.startTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endTime"],
      message: "End time must be after start time"
    });
  }
}

export function ensureDateRange<T extends { startDate?: Date; endDate?: Date }>(
  value: T,
  context: z.RefinementCtx
) {
  if (value.startDate && value.endDate && value.endDate <= value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Cohort end date must be after start date"
    });
  }
}

export function ensureRegistrationWindow<
  T extends { registrationOpenDate?: Date; registrationCloseDate?: Date; startDate?: Date }
>(value: T, context: z.RefinementCtx) {
  if (
    value.registrationOpenDate &&
    value.registrationCloseDate &&
    value.registrationCloseDate <= value.registrationOpenDate
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["registrationCloseDate"],
      message: "Registration close date must be after open date"
    });
  }

  if (value.registrationCloseDate && value.startDate && value.registrationCloseDate > value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["registrationCloseDate"],
      message: "Registration close date cannot be after cohort start date"
    });
  }
}
