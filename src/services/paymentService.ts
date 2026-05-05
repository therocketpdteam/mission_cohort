import { PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { paymentCreateSchema, paymentStatusUpdateSchema, paymentUpdateSchema } from "@/validators/payment";
import { logAuditEventAsync } from "./auditService";
import { queueRegistrationCrmSync } from "./crmSyncService";
import { getRecipientCommunicationSummary } from "./communicationService";

export async function createPaymentRecord(input: z.input<typeof paymentCreateSchema>) {
  const data = paymentCreateSchema.parse(input);
  const payment = await prisma.paymentRecord.create({ data });
  void queueRegistrationCrmSync(payment.registrationId, "payment.created");
  return payment;
}

export async function updatePaymentStatus(id: string, input: z.input<typeof paymentStatusUpdateSchema>) {
  const data = paymentStatusUpdateSchema.parse(input);
  const payment = await prisma.paymentRecord.update({ where: { id }, data });
  logAuditEventAsync({
    entityType: "PaymentRecord",
    entityId: payment.id,
    action: "STATUS_CHANGED",
    description: "Payment status changed",
    metadata: { status: payment.status, registrationId: payment.registrationId }
  });
  void queueRegistrationCrmSync(payment.registrationId, "payment.status_changed");
  return payment;
}

export async function updatePaymentRecord(id: string, input: z.input<typeof paymentUpdateSchema>) {
  const data = paymentUpdateSchema.parse(input);
  return prisma.paymentRecord.update({ where: { id }, data });
}

export async function listPayments() {
  const payments = await prisma.paymentRecord.findMany({
    orderBy: { createdAt: "desc" },
    include: { registration: true, cohort: true, organization: true }
  });
  const summaries = await getRecipientCommunicationSummary(payments.map((payment) => payment.registration.primaryContactEmail));

  return payments.map((payment) => ({
    ...payment,
    emailSummary: summaries[payment.registration.primaryContactEmail.toLowerCase()]
  }));
}

export async function getPendingPayments() {
  const payments = await prisma.paymentRecord.findMany({
    where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.INVOICED, PaymentStatus.PARTIALLY_PAID] } },
    orderBy: { createdAt: "asc" },
    include: { registration: true, cohort: true, organization: true }
  });
  const summaries = await getRecipientCommunicationSummary(payments.map((payment) => payment.registration.primaryContactEmail));

  return payments.map((payment) => ({
    ...payment,
    emailSummary: summaries[payment.registration.primaryContactEmail.toLowerCase()]
  }));
}
