import {
  CommunicationStatus,
  OperationsTaskCategory,
  OperationsTaskStatus,
  ParticipantListStatus,
  ParticipantStatus,
  Prisma
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  readRegistrationPendingChanges,
  registrationPendingChangeCount,
  sentParticipantConfirmationEmails
} from "../src/services/registrationChangeService";

async function main() {
const apply = process.env.APPLY === "1";
const verifiedIds = new Set(
  String(process.env.VERIFIED_STALE_REGISTRATION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const registrations = await prisma.registration.findMany({
  where: { pendingChangesAt: { not: null } },
  select: {
    id: true,
    primaryContactEmail: true,
    participantCount: true,
    pendingChanges: true,
    participants: {
      where: { status: ParticipantStatus.REGISTERED },
      select: { email: true }
    },
    communications: {
      where: {
        status: CommunicationStatus.SENT,
        template: { name: "Participant Registration Confirmation" }
      },
      select: { status: true, recipientEmails: true, template: { select: { name: true } } }
    }
  }
});

const results: Array<Record<string, unknown>> = [];

for (const registration of registrations) {
  const pending = readRegistrationPendingChanges(registration.pendingChanges);
  const changeCount = registrationPendingChangeCount(pending);
  let classification = "requires_review";
  let eligible = false;

  if (!pending || changeCount === 0) {
    classification = "empty_pending_shell";
    eligible = true;
  } else if (
    verifiedIds.has(registration.id)
    && pending.participantAdditions.length > 0
    && pending.participantRemovals.length === 0
    && Object.keys(pending.fields).length === 0
  ) {
    const sent = sentParticipantConfirmationEmails(registration.communications);
    const active = new Set(registration.participants.map((participant) => participant.email.trim().toLowerCase()));
    const additionsDelivered = pending.participantAdditions.every((participant) => sent.has(participant.email.trim().toLowerCase()));
    const additionsActive = pending.participantAdditions.every((participant) => active.has(participant.email.trim().toLowerCase()));
    classification = additionsDelivered && additionsActive
      ? "verified_already_delivered_batch"
      : "verified_id_failed_delivery_checks";
    eligible = additionsDelivered && additionsActive;
  }

  if (apply && eligible) {
    const rosterComplete = registration.participants.length >= registration.participantCount;
    await prisma.$transaction([
      prisma.registration.update({
        where: { id: registration.id },
        data: {
          pendingChanges: Prisma.JsonNull,
          pendingChangesAt: null,
          participantListStatus: rosterComplete ? ParticipantListStatus.COMPLETE : undefined
        }
      }),
      ...(rosterComplete ? [prisma.operationsTask.updateMany({
        where: {
          registrationId: registration.id,
          category: OperationsTaskCategory.PARTICIPANT_LIST,
          status: { in: [OperationsTaskStatus.OPEN, OperationsTaskStatus.IN_PROGRESS] }
        },
        data: {
          status: OperationsTaskStatus.COMPLETED,
          completedAt: new Date(),
          description: "Completed by stale pending-change reconciliation after roster and delivery verification."
        }
      })] : []),
      prisma.auditLog.create({
        data: {
          entityType: "Registration",
          entityId: registration.id,
          action: "STALE_PENDING_CHANGES_RECONCILED",
          description: `Cleared ${classification} without sending communications or updating calendars.`,
          metadata: { classification, changeCount, rosterComplete }
        }
      })
    ]);
  }

  results.push({
    registrationId: registration.id,
    primaryContactEmail: registration.primaryContactEmail,
    changeCount,
    classification,
    eligible,
    action: apply && eligible ? "cleared" : "none"
  });
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", registrations: results }, null, 2));
await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
