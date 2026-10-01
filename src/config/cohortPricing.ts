export const cohortPricingMatrix: Record<number, number> = {
  3: 595,
  4: 695,
  5: 795,
  8: 795
};

export const fiveSessionVolumePricing = [
  { min: 1, max: 4, unitAmount: 495 },
  { min: 5, max: 9, unitAmount: 485 },
  { min: 10, max: 19, unitAmount: 465 },
  { min: 20, max: 49, unitAmount: 455 },
  { min: 50, max: 99, unitAmount: 445 },
  { min: 100, max: Number.POSITIVE_INFINITY, unitAmount: 425 }
] as const;

export function sessionCountForPricing(cohort?: {
  sessions?: unknown[] | null;
  _count?: { sessions?: number | null } | null;
} | null) {
  return Number(cohort?.sessions?.length ?? cohort?._count?.sessions ?? 0);
}

export function pricePerParticipantForCohort(cohort?: {
  pricePerParticipant?: unknown;
  sessions?: unknown[] | null;
  _count?: { sessions?: number | null } | null;
} | null, participantCount?: unknown) {
  const configured = Number(cohort?.pricePerParticipant ?? 0);
  const count = Math.max(0, Number(participantCount ?? 0));
  if (sessionCountForPricing(cohort) === 5 && configured === 495 && count > 0) {
    return fiveSessionVolumePricing.find((tier) => count >= tier.min && count <= tier.max)?.unitAmount ?? configured;
  }
  if (configured > 0) {
    return configured;
  }

  return cohortPricingMatrix[sessionCountForPricing(cohort)] ?? 0;
}

export function registrationTotalForCohort(cohort: Parameters<typeof pricePerParticipantForCohort>[0], participantCount: unknown) {
  const count = Math.max(0, Number(participantCount ?? 0));
  return pricePerParticipantForCohort(cohort, count) * count;
}

export function registrationTotalAfterSeatChange(
  cohort: Parameters<typeof pricePerParticipantForCohort>[0],
  registration: { participantCount?: unknown; totalAmount?: unknown; paymentMethod?: unknown },
  nextParticipantCount: unknown
) {
  const nextCount = Math.max(0, Number(nextParticipantCount ?? 0));
  if (String(registration.paymentMethod ?? "").toUpperCase() === "COMPED") {
    return 0;
  }

  const currentCount = Math.max(0, Number(registration.participantCount ?? 0));
  const currentTotal = Math.max(0, Number(registration.totalAmount ?? 0));
  const cohortUnitPrice = pricePerParticipantForCohort(cohort, nextCount);
  const standardCurrentTotal = registrationTotalForCohort(cohort, currentCount);
  const hasCustomRate = currentCount > 0
    && currentTotal > 0
    && Math.abs(currentTotal - standardCurrentTotal) > 0.009;
  const unitPrice = hasCustomRate ? currentTotal / currentCount : cohortUnitPrice;

  return Math.round(unitPrice * nextCount * 100) / 100;
}
