import { PaymentMethod, PaymentStatus, RegistrationStatus } from "@prisma/client";
import { z } from "zod";
import { moneyInput, nonNegativeIntInput, optionalEmail } from "@/lib/validators";

export const registrationCreateSchema = z.object({
  cohortId: z.string().min(1, "Registration requires a cohort"),
  organizationId: z.string().min(1, "Registration requires an organization"),
  formId: z.string().min(1).optional(),
  primaryContactName: z.string().min(1),
  primaryContactEmail: z.string().email(),
  primaryContactPhone: z.string().optional(),
  primaryContactTitle: z.string().optional(),
  billingContactName: z.string().optional(),
  billingContactEmail: optionalEmail,
  billingAddress: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.UNKNOWN),
  paymentStatus: z.nativeEnum(PaymentStatus).default(PaymentStatus.PENDING),
  invoiceNumber: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  totalAmount: moneyInput.default(0),
  participantCount: nonNegativeIntInput.default(0),
  status: z.nativeEnum(RegistrationStatus).default(RegistrationStatus.NEW),
  source: z.string().optional(),
  notes: z.string().optional()
});

export const registrationUpdateSchema = registrationCreateSchema.partial();
