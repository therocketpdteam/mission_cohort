export function countPendingRegistrationChanges(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const pending = value as Record<string, unknown>;
  return (Array.isArray(pending.participantAdditions) ? pending.participantAdditions.length : 0)
    + (Array.isArray(pending.participantRemovals) ? pending.participantRemovals.length : 0)
    + (pending.fields && typeof pending.fields === "object" && !Array.isArray(pending.fields) ? Object.keys(pending.fields).length : 0);
}
