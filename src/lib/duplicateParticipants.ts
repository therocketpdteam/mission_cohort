export type DuplicateParticipantInput = {
  id?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status?: string | null;
  registrationId?: string | null;
  registration?: {
    id?: string | null;
    status?: string | null;
    archivedAt?: string | null;
    paymentStatus?: string | null;
    invoiceNumber?: string | null;
    createdAt?: string | null;
  } | null;
};

export type DuplicateParticipantGroup = {
  email: string;
  displayName: string;
  registrationIds: string[];
  participants: DuplicateParticipantInput[];
};

export function activeCohortParticipants(rows: DuplicateParticipantInput[]) {
  return rows.filter((row) => (
    String(row.status ?? "REGISTERED").toUpperCase() === "REGISTERED" &&
    String(row.registration?.status ?? "").toUpperCase() !== "CANCELLED" &&
    !row.registration?.archivedAt
  ));
}

export function findDuplicateParticipantGroups(rows: DuplicateParticipantInput[]): DuplicateParticipantGroup[] {
  const grouped = new Map<string, DuplicateParticipantInput[]>();

  for (const participant of activeCohortParticipants(rows)) {
    const email = String(participant.email ?? "").trim().toLowerCase();
    if (!email) continue;
    grouped.set(email, [...(grouped.get(email) ?? []), participant]);
  }

  return Array.from(grouped.entries())
    .map(([email, participants]) => {
      const registrationIds = Array.from(new Set(participants
        .map((participant) => String(participant.registrationId ?? participant.registration?.id ?? ""))
        .filter(Boolean)));
      const named = participants.find((participant) => participant.firstName || participant.lastName);
      return {
        email,
        displayName: `${named?.firstName ?? ""} ${named?.lastName ?? ""}`.trim() || email,
        registrationIds,
        participants
      };
    })
    .filter((group) => group.registrationIds.length > 1)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function uniqueActiveParticipantCount(rows: DuplicateParticipantInput[]) {
  return new Set(activeCohortParticipants(rows)
    .map((participant) => String(participant.email ?? "").trim().toLowerCase())
    .filter(Boolean)).size;
}
