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
