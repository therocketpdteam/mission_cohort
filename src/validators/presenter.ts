import { z } from "zod";

export const presenterCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  bio: z.string().optional(),
  organization: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean().default(true)
});

export const presenterUpdateSchema = presenterCreateSchema.partial();
