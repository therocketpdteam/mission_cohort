import {
  OrganizationType,
  ParticipantListStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
  SupportingDocumentStatus,
  WebhookProcessingStatus
} from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizeJotformRegistrationPayload } from "@/modules/jotform";
import { createDefaultRegistrationOperationsTasks } from "@/services/operationsTaskService";

export async function recordWebhookEvent(input: {
  source: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.webhookEvent.create({
    data: {
      ...input,
      status: WebhookProcessingStatus.RECEIVED
    }
  });
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function badWebhookPayload(message: string) {
  return Object.assign(new Error(message), {
    code: "BAD_REQUEST",
    status: 400
  });
}

export function validateWebhookSecret(request: Request) {
  if (!env.WEBHOOK_SECRET) {
    return true;
  }

  const configuredSecret = env.WEBHOOK_SECRET;
  const headerSecret = request.headers.get("x-webhook-secret");
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return headerSecret === configuredSecret || bearerSecret === configuredSecret;
}

export async function processRegistrationWebhook(payload: Record<string, any>) {
  const normalized =
    stringValue(payload.source).toLowerCase() === "jotform" || payload.answers
      ? normalizeJotformRegistrationPayload(payload)
      : payload;
  const event = await recordWebhookEvent({
    source: stringValue(normalized.source ?? payload.source, "registration_form"),
    eventType: stringValue(payload.eventType, "registration.submitted"),
    payload: payload as Prisma.InputJsonValue
  });

  try {
    const organizationInput = normalized.organization ?? {};
    const registrationInput = normalized.registration ?? normalized;
    const participantsInput = Array.isArray(normalized.participants)
      ? normalized.participants.filter((participant: Record<string, unknown>) => stringValue(participant.email))
      : [];
    const paymentInput = normalized.payment ?? {};
    const fallbackOrgId = `webhook-org-${stringValue(organizationInput.name, event.id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const organizationId = stringValue(organizationInput.id, fallbackOrgId);
    const cohortId = stringValue(registrationInput.cohortId);
    const primaryContactName = stringValue(registrationInput.primaryContactName);
    const primaryContactEmail = stringValue(registrationInput.primaryContactEmail);
    const participantCount = participantsInput.length || numberValue(registrationInput.participantCount);
    const w9Url = stringValue(registrationInput.w9Url);
    const invoiceUrl = stringValue(registrationInput.invoiceUrl);
    const confirmationDocsSentAt = stringValue(registrationInput.confirmationDocsSentAt);

    if (!cohortId) {
      throw badWebhookPayload("registration.cohortId is required");
    }

    if (!primaryContactName || !primaryContactEmail) {
      throw badWebhookPayload("registration.primaryContactName and registration.primaryContactEmail are required");
    }

    for (const participant of participantsInput) {
      if (!stringValue(participant.email)) {
        throw badWebhookPayload("Each participant requires an email");
      }
    }

    const organization = await prisma.organization.upsert({
      where: { id: organizationId },
      update: {
        name: stringValue(organizationInput.name, "Webhook Organization"),
        type: (organizationInput.type as OrganizationType) ?? OrganizationType.OTHER,
        city: stringValue(organizationInput.city) || undefined,
        state: stringValue(organizationInput.state) || undefined,
        phone: stringValue(organizationInput.phone) || undefined,
        notes: stringValue(organizationInput.notes) || undefined
      },
      create: {
        id: organizationId,
        name: stringValue(organizationInput.name, "Webhook Organization"),
        type: (organizationInput.type as OrganizationType) ?? OrganizationType.OTHER,
        city: stringValue(organizationInput.city) || undefined,
        state: stringValue(organizationInput.state) || undefined,
        phone: stringValue(organizationInput.phone) || undefined,
        notes: stringValue(organizationInput.notes, "Created by registration webhook") || undefined
      }
    });

    const registration = await prisma.registration.create({
      data: {
        cohortId,
        organizationId: organization.id,
        formId: stringValue(registrationInput.formId) || undefined,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone: stringValue(registrationInput.primaryContactPhone) || undefined,
        primaryContactTitle: stringValue(registrationInput.primaryContactTitle) || undefined,
        billingContactName: stringValue(registrationInput.billingContactName) || undefined,
        billingContactEmail: stringValue(registrationInput.billingContactEmail) || undefined,
        billingAddress: stringValue(registrationInput.billingAddress) || undefined,
        paymentMethod: (registrationInput.paymentMethod as PaymentMethod) ?? PaymentMethod.UNKNOWN,
        paymentStatus: (registrationInput.paymentStatus as PaymentStatus) ?? PaymentStatus.PENDING,
        invoiceNumber: stringValue(registrationInput.invoiceNumber) || undefined,
        purchaseOrderNumber: stringValue(registrationInput.purchaseOrderNumber) || undefined,
        participantListStatus:
          participantCount === 0
            ? ParticipantListStatus.NOT_REQUESTED
            : participantsInput.length >= participantCount
              ? ParticipantListStatus.COMPLETE
              : participantsInput.length > 0
                ? ParticipantListStatus.PARTIAL
                : ParticipantListStatus.NEEDED,
        supportingDocumentStatus:
          w9Url || invoiceUrl || confirmationDocsSentAt
            ? confirmationDocsSentAt
              ? SupportingDocumentStatus.SENT
              : SupportingDocumentStatus.READY
            : SupportingDocumentStatus.NOT_READY,
        w9Url: w9Url || undefined,
        invoiceUrl: invoiceUrl || undefined,
        confirmationDocsSentAt: confirmationDocsSentAt ? new Date(confirmationDocsSentAt) : undefined,
        quickBooksCustomerRef: stringValue(registrationInput.quickBooksCustomerRef) || undefined,
        quickBooksInvoiceRef: stringValue(registrationInput.quickBooksInvoiceRef) || undefined,
        totalAmount: numberValue(registrationInput.totalAmount),
        participantCount,
        status: (registrationInput.status as RegistrationStatus) ?? RegistrationStatus.NEW,
        source: stringValue(normalized.source, "webhook"),
        notes: stringValue(registrationInput.notes) || undefined
      }
    });

    const participants = await Promise.all(
      participantsInput.map((participant: Record<string, unknown>) =>
        prisma.participant.create({
          data: {
            registrationId: registration.id,
            cohortId: registration.cohortId,
            organizationId: organization.id,
            firstName: stringValue(participant.firstName),
            lastName: stringValue(participant.lastName),
            email: stringValue(participant.email),
            title: stringValue(participant.title) || undefined,
            phone: stringValue(participant.phone) || undefined
          }
        })
      )
    );

    const payment =
      numberValue(paymentInput.amount ?? registrationInput.totalAmount) > 0
        ? await prisma.paymentRecord.create({
            data: {
              registrationId: registration.id,
              cohortId: registration.cohortId,
              organizationId: organization.id,
              amount: numberValue(paymentInput.amount ?? registrationInput.totalAmount),
              status: (paymentInput.status as PaymentStatus) ?? registration.paymentStatus,
              method: (paymentInput.method as PaymentMethod) ?? registration.paymentMethod,
              invoiceNumber: stringValue(paymentInput.invoiceNumber ?? registration.invoiceNumber) || undefined,
              quickBooksPaymentRef: stringValue(paymentInput.quickBooksPaymentRef) || undefined,
              paymentDate: paymentInput.paymentDate ? new Date(String(paymentInput.paymentDate)) : undefined,
              notes: stringValue(paymentInput.notes) || undefined
            }
          })
        : null;

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: WebhookProcessingStatus.PROCESSED,
        processedAt: new Date()
      }
    });

    const operationsTasks = await createDefaultRegistrationOperationsTasks({
      cohortId: registration.cohortId,
      registrationId: registration.id,
      participantCount: registration.participantCount,
      actualParticipantCount: participants.length,
      paymentStatus: registration.paymentStatus,
      hasSupportingDocs: Boolean(registration.w9Url || registration.invoiceUrl || registration.confirmationDocsSentAt)
    });

    return { eventId: event.id, organization, registration, participants, payment, operationsTasks };
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: WebhookProcessingStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Unknown webhook processing error"
      }
    });
    throw error;
  }
}
