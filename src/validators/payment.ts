import { PaymentMethod, PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { dateInput, moneyInput } from "@/lib/validators";

export const paymentCreateSchema = z.object({
  registrationId: z.string().min(1),
  cohortId: z.string().min(1),
  organizationId: z.string().min(1),
  amount: moneyInput,
  status: z.nativeEnum(PaymentStatus).default(PaymentStatus.PENDING),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.UNKNOWN),
  invoiceNumber: z.string().optional(),
  quickBooksPaymentRef: z.string().optional(),
  paymentDate: dateInput.optional(),
  notes: z.string().optional()
});

export const paymentUpdateSchema = paymentCreateSchema.partial();

export const paymentStatusUpdateSchema = z.object({
  status: z.nativeEnum(PaymentStatus),
  paymentDate: dateInput.optional(),
  notes: z.string().optional()
});
