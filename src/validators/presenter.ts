import { z } from "zod";

const requiredTrimmedString = z.string().trim().min(1);
const optionalTrimmedString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional()
);

export const presenterCreateSchema = z.object({
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  shortName: optionalTrimmedString.transform((value) => value?.toUpperCase()),
  email: z.string().trim().toLowerCase().email(),
  bio: optionalTrimmedString,
  organization: optionalTrimmedString,
  phone: optionalTrimmedString,
  quickBooksVendorRef: optionalTrimmedString,
  quickBooksExpenseAccountRef: optionalTrimmedString,
  notes: optionalTrimmedString,
  active: z.boolean().default(true)
});

export const presenterUpdateSchema = presenterCreateSchema.partial();
