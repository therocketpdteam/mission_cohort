import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const organizationInvoiceProfileKey = "organization.invoiceProfile";

export const organizationInvoiceProfileSchema = z.object({
  displayName: z.string().trim().default("RocketPD"),
  legalName: z.string().trim().default("RocketPD"),
  addressLine1: z.string().trim().optional().default(""),
  addressLine2: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  zip: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  website: z.string().trim().optional().default(""),
  taxId: z.string().trim().optional().default(""),
  logoUrl: z.string().trim().optional().default(""),
  logoFileKey: z.string().trim().optional().default(""),
  paymentInstructions: z.string().trim().optional().default("Please include the invoice number with payment."),
  footerNote: z.string().trim().optional().default("In Demand Group, LLC")
});

export type OrganizationInvoiceProfile = z.infer<typeof organizationInvoiceProfileSchema>;

export const defaultOrganizationInvoiceProfile: OrganizationInvoiceProfile = organizationInvoiceProfileSchema.parse({});

export async function getOrganizationInvoiceProfile() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: organizationInvoiceProfileKey }
  });

  return organizationInvoiceProfileSchema.parse({
    ...defaultOrganizationInvoiceProfile,
    ...(setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value) ? setting.value : {})
  });
}

export async function saveOrganizationInvoiceProfile(input: unknown) {
  const value = organizationInvoiceProfileSchema.parse(input);

  await prisma.appSetting.upsert({
    where: { key: organizationInvoiceProfileKey },
    create: {
      key: organizationInvoiceProfileKey,
      value: value as unknown as Prisma.InputJsonValue
    },
    update: {
      value: value as unknown as Prisma.InputJsonValue
    }
  });

  return value;
}
