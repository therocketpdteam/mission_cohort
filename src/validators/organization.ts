import { OrganizationType } from "@prisma/client";
import { z } from "zod";

export const organizationCreateSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(OrganizationType),
  website: z.string().url().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional()
});

export const organizationUpdateSchema = organizationCreateSchema.partial();
