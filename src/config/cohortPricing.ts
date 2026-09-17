export const cohortPricingMatrix: Record<number, number> = {
  3: 595,
  4: 695,
  5: 795,
  8: 795
};

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
} | null) {
  const configured = Number(cohort?.pricePerParticipant ?? 0);
  if (configured > 0) {
    return configured;
  }

  return cohortPricingMatrix[sessionCountForPricing(cohort)] ?? 0;
}

export function registrationTotalForCohort(cohort: Parameters<typeof pricePerParticipantForCohort>[0], participantCount: unknown) {
  return pricePerParticipantForCohort(cohort) * Math.max(0, Number(participantCount ?? 0));
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
  const cohortUnitPrice = pricePerParticipantForCohort(cohort);
  const standardCurrentTotal = cohortUnitPrice * currentCount;
  const hasCustomRate = currentCount > 0
    && currentTotal > 0
    && Math.abs(currentTotal - standardCurrentTotal) > 0.009;
  const unitPrice = hasCustomRate ? currentTotal / currentCount : cohortUnitPrice;

  return Math.round(unitPrice * nextCount * 100) / 100;
}
