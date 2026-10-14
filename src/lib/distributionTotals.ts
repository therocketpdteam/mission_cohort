type RegistrationRevenue = {
  status?: string | null;
  paymentStatus?: string | null;
  totalAmount?: unknown;
};

type PaymentRevenue = {
  status?: string | null;
  amount?: unknown;
};

type DistributionPayout = {
  status?: string | null;
  amount?: unknown;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateDistributionTotals(input: {
  registrations: RegistrationRevenue[];
  payments: PaymentRevenue[];
  payouts: DistributionPayout[];
  commissionPercent: unknown;
  tlSharePercent: unknown;
}) {
  const billableRegistrations = input.registrations.filter((registration) => (
    registration.status !== "CANCELLED" &&
    registration.paymentStatus !== "CANCELLED" &&
    registration.paymentStatus !== "REFUNDED"
  ));
  const soldAmount = billableRegistrations.reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0);
  const paidAmount = input.payments
    .filter((payment) => payment.status === "PAID" || payment.status === "PARTIALLY_PAID")
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const payoutMade = input.payouts
    .filter((payout) => payout.status === "PAID" || payout.status === "PARTIAL")
    .reduce((sum, payout) => sum + Number(payout.amount ?? 0), 0);
  const collectibleAmount = billableRegistrations
    .filter((registration) => registration.paymentStatus !== "UNCOLLECTIBLE")
    .reduce((sum, registration) => sum + Number(registration.totalAmount ?? 0), 0);
  const commissionableAmount = Math.max(paidAmount, collectibleAmount);
  const commissionAmount = roundMoney(commissionableAmount * (Number(input.commissionPercent ?? 0) / 100));
  const tlShareAmount = roundMoney(commissionableAmount * (Number(input.tlSharePercent ?? 0) / 100));
  const paymentRatio = commissionableAmount > 0 ? paidAmount / commissionableAmount : 0;
  const tlPayoutDue = roundMoney(paidAmount * (Number(input.tlSharePercent ?? 0) / 100));
  const pendingPayout = roundMoney(Math.max(tlPayoutDue - payoutMade, 0));
  const projectReturn = roundMoney(paidAmount - payoutMade);

  return {
    soldAmount,
    commissionableAmount,
    paidAmount,
    outstandingAmount: roundMoney(Math.max(commissionableAmount - paidAmount, 0)),
    commissionAmount,
    tlShareAmount,
    paymentRatio,
    tlPayoutDue,
    payoutMade,
    pendingPayout,
    projectReturn,
    returnPercent: paidAmount > 0 ? roundMoney((projectReturn / paidAmount) * 100) : 0
  };
}
