import { CrmSyncEventStatus, Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  crmRegistrationWebhookHeaders,
  isCrmRegistrationWebhookPayload
} from "@/services/crmRegistrationWebhookService";

export async function queueCrmSyncEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  registrationId?: string;
  participantId?: string;
  organizationId?: string;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.crmSyncEvent.create({
    data: {
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      registrationId: input.registrationId,
      participantId: input.participantId,
      organizationId: input.organizationId,
      payload: JSON.parse(JSON.stringify(input.payload))
    }
  });
}

export async function queueRegistrationCrmSync(registrationId: string, eventType = "registration.updated") {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { cohort: true, organization: true, participants: true, paymentRecords: true }
  });

  if (!registration) {
    return null;
  }

  return queueCrmSyncEvent({
    eventType,
    entityType: "Registration",
    entityId: registration.id,
    registrationId: registration.id,
    organizationId: registration.organizationId,
    payload: {
      missionControlId: registration.id,
      cohort: { id: registration.cohort.id, title: registration.cohort.title, slug: registration.cohort.slug },
      organization: { id: registration.organization.id, name: registration.organization.name, type: registration.organization.type },
      primaryContact: {
        name: registration.primaryContactName,
        email: registration.primaryContactEmail,
        phone: registration.primaryContactPhone,
        title: registration.primaryContactTitle
      },
      registration: {
        status: registration.status,
        source: registration.source,
        participantCount: registration.participantCount,
        participantListStatus: registration.participantListStatus,
        paymentStatus: registration.paymentStatus,
        totalAmount: Number(registration.totalAmount)
      }
    }
  });
}

export async function queueParticipantCrmSync(participantId: string, eventType = "participant.updated") {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: { cohort: true, organization: true, registration: true }
  });

  if (!participant) {
    return null;
  }

  return queueCrmSyncEvent({
    eventType,
    entityType: "Participant",
    entityId: participant.id,
    participantId: participant.id,
    registrationId: participant.registrationId,
    organizationId: participant.organizationId,
    payload: {
      missionControlId: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      email: participant.email,
      title: participant.title,
      phone: participant.phone,
      status: participant.status,
      cohort: { id: participant.cohort.id, title: participant.cohort.title, slug: participant.cohort.slug },
      organization: { id: participant.organization.id, name: participant.organization.name },
      registration: { id: participant.registration.id, primaryContactEmail: participant.registration.primaryContactEmail }
    }
  });
}

export async function processCrmSyncEvents(limit = 25) {
  const events = await prisma.crmSyncEvent.findMany({
    where: { status: { in: [CrmSyncEventStatus.QUEUED, CrmSyncEventStatus.FAILED] } },
    orderBy: { createdAt: "asc" },
    take: limit
  });
  const results = [];

  for (const event of events) {
    const missionPayload = isCrmRegistrationWebhookPayload(event.payload);
    const url = missionPayload
      ? env.CRM_MISSION_COHORT_WEBHOOK_URL ?? env.CRM_REGISTRATION_WEBHOOK_URL
      : env.CRM_WEBHOOK_URL;
    const secret = missionPayload
      ? env.CRM_MISSION_COHORT_WEBHOOK_SECRET ?? env.CRM_REGISTRATION_WEBHOOK_SECRET
      : env.CRM_WEBHOOK_SECRET;
    const missingConfigMessage = missionPayload
      ? "CRM Mission Cohort webhook is not configured."
      : "CRM webhook is not configured.";

    if (!url || !secret) {
      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: {
          status: CrmSyncEventStatus.FAILED,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: missingConfigMessage
        }
      });
      results.push({ id: event.id, status: "failed", error: missingConfigMessage });
      continue;
    }

    await prisma.crmSyncEvent.update({
      where: { id: event.id },
      data: { status: CrmSyncEventStatus.SENDING, lastAttemptAt: new Date() }
    });

    try {
      const response = missionPayload
        ? await fetch(url, {
            method: "POST",
            headers: crmRegistrationWebhookHeaders(secret, env.CRM_MISSION_COHORT_VERCEL_BYPASS_SECRET),
            body: JSON.stringify(event.payload)
          })
        : await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-mission-control-secret": secret
            },
            body: JSON.stringify({
              eventType: event.eventType,
              entityType: event.entityType,
              entityId: event.entityId,
              payload: event.payload
            })
          });

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(
          `CRM webhook failed with status ${response.status}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`
        );
      }

      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: { status: CrmSyncEventStatus.SENT, sentAt: new Date(), errorMessage: null }
      });
      results.push({ id: event.id, status: "sent" });
    } catch (error) {
      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: {
          status: CrmSyncEventStatus.FAILED,
          attempts: { increment: 1 },
          errorMessage: error instanceof Error ? error.message : "Unknown CRM sync error"
        }
      });
      results.push({ id: event.id, status: "failed", error: error instanceof Error ? error.message : "Unknown CRM sync error" });
    }
  }

  return results;
}

export async function listCrmSyncEvents() {
  return prisma.crmSyncEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
