import { PaymentStatus } from "@prisma/client";

type PaymentRecordStatusInput = {
  status?: PaymentStatus | string | null;
  amount?: unknown;
};

const paymentStatusValues = new Set(Object.values(PaymentStatus));

function normalizePaymentStatus(value: PaymentStatus | string | null | undefined) {
  const status = String(value ?? "").toUpperCase();
  return paymentStatusValues.has(status as PaymentStatus) ? status as PaymentStatus : null;
}

function moneyNumber(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function deriveRegistrationPaymentStatusFromRecords(
  paymentRecords: PaymentRecordStatusInput[],
  fallback: PaymentStatus = PaymentStatus.PENDING,
  totalAmount?: unknown
) {
  const statuses = paymentRecords
    .map((payment) => normalizePaymentStatus(payment.status))
    .filter((status): status is PaymentStatus => Boolean(status));

  if (statuses.length === 0) {
    return fallback;
  }

  const activeStatuses = statuses.filter((status) => status !== PaymentStatus.CANCELLED && status !== PaymentStatus.REFUNDED);
  if (activeStatuses.length === 0) {
    return statuses.includes(PaymentStatus.REFUNDED) ? PaymentStatus.REFUNDED : PaymentStatus.CANCELLED;
  }

  const collectedAmount = paymentRecords.reduce((sum, payment) => {
    const status = normalizePaymentStatus(payment.status);
    return status === PaymentStatus.PAID || status === PaymentStatus.PARTIALLY_PAID
      ? sum + moneyNumber(payment.amount)
      : sum;
  }, 0);
  const expectedAmount = moneyNumber(totalAmount);

  if ((expectedAmount > 0 && collectedAmount >= expectedAmount) || activeStatuses.includes(PaymentStatus.PAID)) {
    return PaymentStatus.PAID;
  }

  if (collectedAmount > 0 || activeStatuses.includes(PaymentStatus.PARTIALLY_PAID)) {
    return PaymentStatus.PARTIALLY_PAID;
  }

  if (activeStatuses.includes(PaymentStatus.INVOICED)) {
    return PaymentStatus.INVOICED;
  }

  if (activeStatuses.includes(PaymentStatus.PENDING)) {
    return PaymentStatus.PENDING;
  }

  return fallback;
}
