import { registrationCollectedAmount } from "./cohortFinance";

export const PAYMENT_STATUS_FOLLOW_UP_TITLE = "Follow up on payment status";

export function isRegistrationPaymentSettled(registration: Parameters<typeof registrationCollectedAmount>[0]) {
  if (["REFUNDED", "CANCELLED"].includes(String(registration.paymentStatus))) return false;
  return registration.paymentStatus === "PAID" || (Number(registration.totalAmount) > 0 && Math.round(registrationCollectedAmount(registration) * 100) >= Math.round(Number(registration.totalAmount) * 100));
}

export function isPaymentStatusFollowUp(task: { category?: string | null; title?: string | null }) {
  return task.category === "PAYMENT_FOLLOW_UP" && task.title === PAYMENT_STATUS_FOLLOW_UP_TITLE;
}

export function isOpenRegistrationFollowUp(task: { status?: string | null; category?: string | null; title?: string | null }, registration: Parameters<typeof registrationCollectedAmount>[0]) {
  return ["OPEN", "IN_PROGRESS"].includes(String(task.status))
    && !(isRegistrationPaymentSettled(registration) && isPaymentStatusFollowUp(task));
}
