import { ParticipantListStatus } from "@prisma/client";

export function shouldDefaultPrimaryContactParticipant(expectedCount: number, actualCount: number) {
  return expectedCount === 1 && actualCount === 0;
}

export function deriveParticipantListStatus(expectedCount: number, actualCount: number) {
  if (expectedCount === 0 && actualCount === 0) {
    return ParticipantListStatus.NOT_REQUESTED;
  }
  if (expectedCount === 0 || actualCount >= expectedCount) {
    return ParticipantListStatus.COMPLETE;
  }
  if (actualCount > 0) {
    return ParticipantListStatus.PARTIAL;
  }
  return ParticipantListStatus.NEEDED;
}
