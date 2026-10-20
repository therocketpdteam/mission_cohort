type Registration = {
  id: string;
  primaryContactEmail: string;
  source?: string | null;
  externalSource?: string | null;
  participants: Array<{ id: string; email: string; status: string }>;
};

export function cohortCancellationRecipients(registrations: Registration[]) {
  registrations = registrations.filter((registration) => registration.source !== "historical_import" && registration.externalSource !== "historical_import");
  const normalize = (email: string) => email.trim().toLowerCase();
  const pocs = registrations.map((registration) => ({
    role: "poc" as const,
    registrationId: registration.id,
    participantId: undefined as string | undefined,
    email: normalize(registration.primaryContactEmail)
  }));
  const pocEmails = new Set(pocs.map((poc) => poc.email));
  const seen = new Set<string>();
  const participants = registrations.flatMap((registration) => registration.participants.flatMap((participant) => {
    const email = normalize(participant.email);
    if (participant.status !== "REGISTERED" || !email || pocEmails.has(email) || seen.has(email)) return [];
    seen.add(email);
    return [{ role: "participant" as const, registrationId: registration.id, participantId: participant.id, email }];
  }));
  return [...pocs, ...participants];
}

export function cancellationNoticeCanSend(status: string) {
  if (status === "SENT") return false;
  if (status !== "DRAFT") {
    throw new Error("A cancellation notice needs delivery review in Communications. Review or retry that notice there before continuing; it will not be resent automatically.");
  }
  return true;
}

export function cancellationBlocksDelivery(cohortId: string, journeyKey: string | null, taskStatus?: string | null) {
  return !journeyKey?.startsWith(`cohort:${cohortId}:cancellation:`)
    && (taskStatus === "OPEN" || taskStatus === "IN_PROGRESS");
}

export async function runCohortCancellationSteps<T>(steps: {
  preflight: () => Promise<void>;
  pauseReminders: () => Promise<void>;
  sendNotices: () => Promise<void>;
  removeCalendar: () => Promise<void>;
  finalize: () => Promise<T>;
}) {
  await steps.preflight();
  await steps.pauseReminders();
  await steps.sendNotices();
  await steps.removeCalendar();
  return steps.finalize();
}
