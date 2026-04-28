import { OrganizationType, PaymentMethod, PaymentStatus, RegistrationStatus, WebhookProcessingStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function recordWebhookEvent(input: {
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
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
  const event = await recordWebhookEvent({
    source: stringValue(payload.source, "registration_form"),
    eventType: stringValue(payload.eventType, "registration.submitted"),
    payload
  });

  try {
    const organizationInput = payload.organization ?? {};
    const registrationInput = payload.registration ?? payload;
    const participantsInput = Array.isArray(payload.participants) ? payload.participants : [];
    const paymentInput = payload.payment ?? {};
    const fallbackOrgId = `webhook-org-${stringValue(organizationInput.name, "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const organizationId = stringValue(organizationInput.id, fallbackOrgId);

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
        cohortId: stringValue(registrationInput.cohortId),
        organizationId: organization.id,
        formId: stringValue(registrationInput.formId) || undefined,
        primaryContactName: stringValue(registrationInput.primaryContactName),
        primaryContactEmail: stringValue(registrationInput.primaryContactEmail),
        primaryContactPhone: stringValue(registrationInput.primaryContactPhone) || undefined,
        primaryContactTitle: stringValue(registrationInput.primaryContactTitle) || undefined,
        billingContactName: stringValue(registrationInput.billingContactName) || undefined,
        billingContactEmail: stringValue(registrationInput.billingContactEmail) || undefined,
        billingAddress: stringValue(registrationInput.billingAddress) || undefined,
        paymentMethod: (registrationInput.paymentMethod as PaymentMethod) ?? PaymentMethod.UNKNOWN,
        paymentStatus: (registrationInput.paymentStatus as PaymentStatus) ?? PaymentStatus.PENDING,
        invoiceNumber: stringValue(registrationInput.invoiceNumber) || undefined,
        purchaseOrderNumber: stringValue(registrationInput.purchaseOrderNumber) || undefined,
        totalAmount: numberValue(registrationInput.totalAmount),
        participantCount: participantsInput.length || numberValue(registrationInput.participantCount),
        status: (registrationInput.status as RegistrationStatus) ?? RegistrationStatus.NEW,
        source: "webhook",
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

    return { eventId: event.id, organization, registration, participants, payment };
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
