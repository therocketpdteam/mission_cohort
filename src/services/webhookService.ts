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
import { listActiveJotformFormMappings } from "@/services/jotformMappingService";
import { createDefaultRegistrationOperationsTasks } from "@/services/operationsTaskService";
import { queueParticipantCrmSync, queueRegistrationCrmSync } from "@/services/crmSyncService";

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
  const querySecret = new URL(request.url).searchParams.get("secret");

  return headerSecret === configuredSecret || bearerSecret === configuredSecret || querySecret === configuredSecret;
}

export async function processRegistrationWebhook(payload: Record<string, any>) {
  const isJotformPayload = Boolean(
    stringValue(payload.source).toLowerCase() === "jotform" ||
      payload.answers ||
      payload.rawRequest ||
      payload.formID ||
      payload.formId ||
      payload.submissionID
  );
  const event = await recordWebhookEvent({
    source: stringValue(payload.source, isJotformPayload ? "jotform" : "registration_form"),
    eventType: stringValue(payload.eventType, "registration.submitted"),
    payload: payload as Prisma.InputJsonValue
  });

  try {
    const mappings = isJotformPayload ? await listActiveJotformFormMappings() : [];
    const normalized =
      isJotformPayload
        ? normalizeJotformRegistrationPayload(payload, mappings)
        : payload;
    const organizationInput = normalized.organization ?? {};
    const registrationInput = normalized.registration ?? normalized;
    const participantsInput = Array.isArray(normalized.participants)
      ? normalized.participants.filter((participant: Record<string, unknown>) => stringValue(participant.email))
      : [];
    const paymentInput = normalized.payment ?? {};
    const fallbackOrgId = `webhook-org-${stringValue(organizationInput.name, event.id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const organizationId = stringValue(organizationInput.id, fallbackOrgId);
    let cohortId = stringValue(registrationInput.cohortId);
    const cohortSlug = stringValue(registrationInput.cohortSlug ?? normalized.routing?.cohortSlug);
    const primaryContactName = stringValue(registrationInput.primaryContactName);
    const primaryContactEmail = stringValue(registrationInput.primaryContactEmail);
    const declaredParticipantCount = numberValue(registrationInput.participantCount);
    const participantCount = declaredParticipantCount || participantsInput.length;
    const w9Url = stringValue(registrationInput.w9Url);
    const invoiceUrl = stringValue(registrationInput.invoiceUrl);
    const confirmationDocsSentAt = stringValue(registrationInput.confirmationDocsSentAt);
    const externalSource = stringValue(normalized.source, "webhook");
    const externalSubmissionId = stringValue(normalized.externalSubmissionId);

    if (Array.isArray(normalized.participantParseErrors) && normalized.participantParseErrors.length > 0) {
      throw badWebhookPayload(`Participant list could not be parsed: ${normalized.participantParseErrors.join("; ")}`);
    }

    if (!cohortId && cohortSlug) {
      const cohort = await prisma.cohort.findUnique({ where: { slug: cohortSlug } });

      if (!cohort) {
        throw badWebhookPayload(`No cohort found for cohortSlug "${cohortSlug}"`);
      }

      cohortId = cohort.id;
    }

    if (!cohortId) {
      throw badWebhookPayload("registration.cohortId or registration.cohortSlug is required");
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

    const existingRegistration =
      externalSubmissionId
        ? await prisma.registration.findFirst({
            where: { externalSource, externalSubmissionId },
            include: { participants: true, paymentRecords: true }
          })
        : null;

    const registrationData = {
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
      source: externalSource,
      externalSource: externalSubmissionId ? externalSource : undefined,
      externalSubmissionId: externalSubmissionId || undefined,
      notes: stringValue(registrationInput.notes) || undefined
    };
    const existingPaymentRecord = existingRegistration?.paymentRecords[0];
    const paymentAmount = numberValue(paymentInput.amount ?? registrationInput.totalAmount);

    const registration = existingRegistration
      ? await prisma.registration.update({
          where: { id: existingRegistration.id },
          data: registrationData
        })
      : await prisma.registration.create({ data: registrationData });

    if (existingRegistration) {
      await prisma.participant.deleteMany({ where: { registrationId: registration.id } });
    }

    const participants = await Promise.all(
      participantsInput.map((participant: Record<string, unknown>) =>
        prisma.participant.create({
          data: {
            registrationId: registration.id,
            cohortId: registration.cohortId,
            organizationId: organization.id,
            firstName: stringValue(participant.firstName, "Participant"),
            lastName: stringValue(participant.lastName, "-"),
            email: stringValue(participant.email),
            title: stringValue(participant.title) || undefined,
            phone: stringValue(participant.phone) || undefined
          }
        })
      )
    );

    const payment =
      paymentAmount > 0
        ? existingPaymentRecord
          ? await prisma.paymentRecord.update({
              where: { id: existingPaymentRecord.id },
              data: {
                cohortId: registration.cohortId,
                organizationId: organization.id,
                amount: paymentAmount,
                status: (paymentInput.status as PaymentStatus) ?? registration.paymentStatus,
                method: (paymentInput.method as PaymentMethod) ?? registration.paymentMethod,
                invoiceNumber: stringValue(paymentInput.invoiceNumber ?? registration.invoiceNumber) || undefined,
                quickBooksPaymentRef: stringValue(paymentInput.quickBooksPaymentRef) || undefined,
                quickBooksInvoiceRef: stringValue(registration.quickBooksInvoiceRef) || undefined,
                quickBooksRealmId: stringValue(registration.quickBooksRealmId) || undefined,
                paymentDate: paymentInput.paymentDate ? new Date(String(paymentInput.paymentDate)) : undefined,
                notes: stringValue(paymentInput.notes) || undefined
              }
            })
          : await prisma.paymentRecord.create({
              data: {
                registrationId: registration.id,
                cohortId: registration.cohortId,
                organizationId: organization.id,
                amount: paymentAmount,
                status: (paymentInput.status as PaymentStatus) ?? registration.paymentStatus,
                method: (paymentInput.method as PaymentMethod) ?? registration.paymentMethod,
                invoiceNumber: stringValue(paymentInput.invoiceNumber ?? registration.invoiceNumber) || undefined,
                quickBooksPaymentRef: stringValue(paymentInput.quickBooksPaymentRef) || undefined,
                quickBooksInvoiceRef: stringValue(registration.quickBooksInvoiceRef) || undefined,
                quickBooksRealmId: stringValue(registration.quickBooksRealmId) || undefined,
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

    const operationsTasks = existingRegistration
      ? []
      : await createDefaultRegistrationOperationsTasks({
          cohortId: registration.cohortId,
          registrationId: registration.id,
          participantCount: registration.participantCount,
          actualParticipantCount: participants.length,
          paymentStatus: registration.paymentStatus,
          hasSupportingDocs: Boolean(registration.w9Url || registration.invoiceUrl || registration.confirmationDocsSentAt)
        });
    void queueRegistrationCrmSync(registration.id, existingRegistration ? "registration.updated" : "registration.created");
    for (const participant of participants) {
      void queueParticipantCrmSync(participant.id, existingRegistration ? "participant.updated" : "participant.created");
    }

    return {
      eventId: event.id,
      created: !existingRegistration,
      updated: Boolean(existingRegistration),
      cohortId: registration.cohortId,
      externalSubmissionId,
      participantsCreated: participants.length,
      organization,
      registration,
      participants,
      payment,
      operationsTasks
    };
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
