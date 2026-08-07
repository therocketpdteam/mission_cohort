import { PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deriveRegistrationPaymentStatusFromRecords } from "@/lib/paymentStatus";
import { paymentCreateSchema, paymentStatusUpdateSchema, paymentUpdateSchema } from "@/validators/payment";
import { logAuditEventAsync } from "./auditService";
import { queueRegistrationCrmSync } from "./crmSyncService";
import { getRecipientCommunicationSummary } from "./communicationService";

export async function syncRegistrationPaymentStatusFromPaymentRecords(registrationId: string) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      paymentStatus: true,
      totalAmount: true,
      paymentRecords: { select: { status: true, amount: true } }
    }
  });

  if (!registration) {
    return null;
  }

  const paymentStatus = deriveRegistrationPaymentStatusFromRecords(
    registration.paymentRecords,
    registration.paymentStatus,
    registration.totalAmount
  );

  if (paymentStatus !== registration.paymentStatus) {
    await prisma.registration.update({
      where: { id: registrationId },
      data: { paymentStatus }
    });
  }

  return paymentStatus;
}

export async function syncPaymentRecordsToRegistrationStatus(registrationId: string, status: PaymentStatus) {
  await prisma.paymentRecord.updateMany({
    where: { registrationId },
    data: { status }
  });
  return syncRegistrationPaymentStatusFromPaymentRecords(registrationId);
}

export async function createPaymentRecord(input: z.input<typeof paymentCreateSchema>) {
  const data = paymentCreateSchema.parse(input);
  const payment = await prisma.paymentRecord.create({ data });
  await syncRegistrationPaymentStatusFromPaymentRecords(payment.registrationId);
  void queueRegistrationCrmSync(payment.registrationId, "payment.created").catch(() => undefined);
  return payment;
}

export async function updatePaymentStatus(id: string, input: z.input<typeof paymentStatusUpdateSchema>) {
  const data = paymentStatusUpdateSchema.parse(input);
  const payment = await prisma.paymentRecord.update({ where: { id }, data });
  const registrationPaymentStatus = await syncRegistrationPaymentStatusFromPaymentRecords(payment.registrationId);
  logAuditEventAsync({
    entityType: "PaymentRecord",
    entityId: payment.id,
    action: "STATUS_CHANGED",
    description: "Payment status changed",
    metadata: { status: payment.status, registrationPaymentStatus, registrationId: payment.registrationId }
  });
  void queueRegistrationCrmSync(payment.registrationId, "payment.status_changed").catch(() => undefined);
  return payment;
}

export async function updatePaymentRecord(id: string, input: z.input<typeof paymentUpdateSchema>) {
  const data = paymentUpdateSchema.parse(input);
  const payment = await prisma.paymentRecord.update({ where: { id }, data });
  await syncRegistrationPaymentStatusFromPaymentRecords(payment.registrationId);
  void queueRegistrationCrmSync(payment.registrationId, "payment.updated").catch(() => undefined);
  return payment;
}

export async function listPayments(cohortId?: string | null) {
  const payments = await prisma.paymentRecord.findMany({
    where: cohortId ? { cohortId } : undefined,
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
