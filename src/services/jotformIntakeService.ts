import { randomBytes } from "node:crypto";
import { IntegrationConnectionStatus, IntegrationProvider, WebhookProcessingStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { previewJotformRegistrationPayload } from "@/modules/jotform";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";
import { listActiveJotformFormMappings } from "@/services/jotformMappingService";
import { processRegistrationWebhook } from "@/services/webhookService";

function appBaseUrl() {
  return (env.APP_BASE_URL ?? "https://mission-cohort-six.vercel.app").replace(/\/$/, "");
}

export function buildJotformWebhookUrl(secret: string) {
  return `${appBaseUrl()}/api/webhooks/registrations?secret=${encodeURIComponent(secret)}`;
}

export async function getJotformIntakeSetup() {
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.JOTFORM);
  const secret = connection?.accessToken ?? "";

  return {
    configured: Boolean(secret),
    webhookUrl: secret ? buildJotformWebhookUrl(secret) : "",
    lastRotatedAt: connection?.updatedAt ?? null,
    connectionStatus: connection?.status ?? IntegrationConnectionStatus.NOT_CONFIGURED
  };
}

export async function rotateJotformWebhookSecret() {
  const secret = randomBytes(32).toString("hex");
  const connection = await upsertIntegrationConnection({
    provider: IntegrationProvider.JOTFORM,
    label: "default",
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "Jotform Webhook Intake",
    accessToken: secret,
    metadata: {
      purpose: "jotform_registration_webhook",
      webhookUrl: buildJotformWebhookUrl(secret)
    }
  });

  return {
    configured: true,
    webhookUrl: buildJotformWebhookUrl(secret),
    lastRotatedAt: connection.updatedAt,
    connectionStatus: connection.status
  };
}

export async function listJotformIntakeEvents() {
  const [events, mappings] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: { source: "jotform" },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    listActiveJotformFormMappings()
  ]);

  return events.map((event) => {
    const preview = previewJotformRegistrationPayload(event.payload as Record<string, unknown>, mappings);
    const needsMapping = Boolean(preview.formId) && !preview.hasMapping;
    const missingRequiredFields = [
      !preview.formId ? "Jotform form ID" : "",
      !preview.submissionId ? "submission ID" : "",
      !preview.primaryContactName ? "primary contact name" : "",
      !preview.primaryContactEmail ? "primary contact email" : "",
      !preview.organizationName ? "organization name" : "",
      !preview.cohortSlug && !preview.normalized?.registration?.cohortId ? "cohort routing" : ""
    ].filter(Boolean);
    const hasParticipantErrors = preview.participantParseErrors.length > 0;
    const isProcessed = event.status === WebhookProcessingStatus.PROCESSED;
    const canReplay = !isProcessed && !needsMapping && !hasParticipantErrors && missingRequiredFields.length === 0;
    const reviewStatus = isProcessed
      ? "PROCESSED"
      : hasParticipantErrors || event.status === WebhookProcessingStatus.FAILED
        ? "FAILED"
        : needsMapping
          ? "NEEDS_MAPPING"
          : canReplay
            ? "READY_TO_REPLAY"
            : "REVIEW_REQUIRED";
    const recommendedAction = isProcessed
      ? "Already imported into Mission Control."
      : hasParticipantErrors
        ? "Fix the participant list in Jotform or review the bad lines before replaying."
        : needsMapping
          ? "Review this submission, confirm the form mapping, then replay it."
          : missingRequiredFields.length > 0
            ? `Review missing ${missingRequiredFields.join(", ")} before replaying.`
            : "Ready to replay into registrations.";

    return {
      ...event,
      preview,
      needsMapping,
      reviewStatus,
      readiness: {
        canReplay,
        needsMapping,
        hasParticipantErrors,
        missingRequiredFields,
        recommendedAction
      }
    };
  });
}

export async function replayJotformWebhookEvent(id: string) {
  const event = await prisma.webhookEvent.findUnique({ where: { id } });

  if (!event) {
    throw Object.assign(new Error("Jotform webhook event not found"), { code: "NOT_FOUND", status: 404 });
  }

  if (event.source !== "jotform") {
    throw Object.assign(new Error("Only Jotform webhook events can be replayed here"), { code: "BAD_REQUEST", status: 400 });
  }

  return processRegistrationWebhook(event.payload as Record<string, any>, { existingEventId: event.id });
}
