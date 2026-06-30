import { ParticipantListStatus } from "@prisma/client";

type ParticipantTitleInput = { title?: string | null };

export function shouldDefaultPrimaryContactParticipant(expectedCount: number, actualCount: number) {
  return expectedCount === 1 && actualCount === 0;
}

export function countParticipantsMissingTitles(participants: ParticipantTitleInput[]) {
  return participants.filter((participant) => !participant.title?.trim()).length;
}

export function deriveParticipantListStatus(expectedCount: number, actualCount: number, missingTitleCount = 0) {
  if (expectedCount === 0 && actualCount === 0) {
    return ParticipantListStatus.NOT_REQUESTED;
  }
  if (actualCount > 0 && missingTitleCount > 0) {
    return ParticipantListStatus.PARTIAL;
  }
  if (expectedCount === 0 || actualCount >= expectedCount) {
    return ParticipantListStatus.COMPLETE;
  }
  if (actualCount > 0) {
    return ParticipantListStatus.PARTIAL;
  }
  return ParticipantListStatus.NEEDED;
}
