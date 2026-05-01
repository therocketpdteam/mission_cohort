import {
  IntegrationConnectionStatus,
  IntegrationProvider,
  PaymentStatus,
  QuickBooksInvoiceStatus,
  SyncStatus,
  WebhookProcessingStatus
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  exchangeQuickBooksCode,
  fetchQuickBooksInvoice,
  getQuickBooksConnectUrl,
  verifyQuickBooksWebhookSignature,
  voidQuickBooksInvoice
} from "@/modules/quickbooks";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";

export function getQuickBooksOAuthUrl() {
  return getQuickBooksConnectUrl();
}

export async function completeQuickBooksOAuth(code: string, realmId?: string | null) {
  const token = await exchangeQuickBooksCode(code);
  return upsertIntegrationConnection({
    provider: IntegrationProvider.QUICKBOOKS,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "QuickBooks Online",
    realmId: realmId ?? undefined,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    metadata: { refreshTokenExpiresIn: token.x_refresh_token_expires_in ?? null }
  });
}

function invoiceStatusFromQuickBooks(invoice: Record<string, any>) {
  if (invoice.PrivateNote?.toLowerCase?.().includes("void") || invoice.status === "Voided") {
    return QuickBooksInvoiceStatus.VOIDED;
  }

  if (Number(invoice.Balance ?? 0) <= 0) {
    return QuickBooksInvoiceStatus.PAID;
  }

  return QuickBooksInvoiceStatus.OPEN;
}

function paymentStatusFromInvoiceStatus(status: QuickBooksInvoiceStatus) {
  if (status === QuickBooksInvoiceStatus.PAID) {
    return PaymentStatus.PAID;
  }

  if (status === QuickBooksInvoiceStatus.VOIDED || status === QuickBooksInvoiceStatus.CANCELLED) {
    return PaymentStatus.CANCELLED;
  }

  return PaymentStatus.INVOICED;
}

export async function syncQuickBooksInvoice(invoiceId: string, realmId?: string) {
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.QUICKBOOKS);

  if (!connection?.accessToken) {
    throw Object.assign(new Error("QuickBooks is not connected."), { code: "BAD_REQUEST", status: 400 });
  }

  const resolvedRealmId = realmId ?? connection.realmId;

  if (!resolvedRealmId) {
    throw Object.assign(new Error("QuickBooks realm ID is missing."), { code: "BAD_REQUEST", status: 400 });
  }

  const result = await fetchQuickBooksInvoice({
    realmId: resolvedRealmId,
    accessToken: connection.accessToken,
    invoiceId
  });
  const invoice = result.Invoice ?? result;
  const invoiceStatus = invoiceStatusFromQuickBooks(invoice);
  const paymentStatus = paymentStatusFromInvoiceStatus(invoiceStatus);
  const registrations = await prisma.registration.updateMany({
    where: { quickBooksInvoiceRef: invoiceId },
    data: {
      paymentStatus,
      quickBooksRealmId: resolvedRealmId,
      quickBooksInvoiceStatus: invoiceStatus,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });
  const payments = await prisma.paymentRecord.updateMany({
    where: { quickBooksInvoiceRef: invoiceId },
    data: {
      status: paymentStatus,
      quickBooksRealmId: resolvedRealmId,
      quickBooksInvoiceStatus: invoiceStatus,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });

  return { invoiceId, invoiceStatus, paymentStatus, registrations: registrations.count, payments: payments.count };
}

export async function syncQuickBooksPayment(paymentId: string, realmId?: string) {
  const payments = await prisma.paymentRecord.updateMany({
    where: { quickBooksPaymentRef: paymentId },
    data: {
      status: PaymentStatus.PAID,
      quickBooksRealmId: realmId,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });
  const linkedPayments = await prisma.paymentRecord.findMany({
    where: { quickBooksPaymentRef: paymentId },
    select: { registrationId: true }
  });

  await prisma.registration.updateMany({
    where: { id: { in: linkedPayments.map((payment) => payment.registrationId) } },
    data: {
      paymentStatus: PaymentStatus.PAID,
      quickBooksRealmId: realmId,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });

  return { paymentId, paymentStatus: PaymentStatus.PAID, payments: payments.count };
}

export async function voidRegistrationQuickBooksInvoice(registrationId: string) {
  const registration = await prisma.registration.findUnique({ where: { id: registrationId } });

  if (!registration?.quickBooksInvoiceRef) {
    throw Object.assign(new Error("Registration does not have a QuickBooks invoice reference."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.QUICKBOOKS);

  if (!connection?.accessToken) {
    throw Object.assign(new Error("QuickBooks is not connected."), { code: "BAD_REQUEST", status: 400 });
  }

  const realmId = registration.quickBooksRealmId ?? connection.realmId;

  if (!realmId) {
    throw Object.assign(new Error("QuickBooks realm ID is missing."), { code: "BAD_REQUEST", status: 400 });
  }

  const invoiceResult = await fetchQuickBooksInvoice({
    realmId,
    accessToken: connection.accessToken,
    invoiceId: registration.quickBooksInvoiceRef
  });
  const voidResult = await voidQuickBooksInvoice({
    realmId,
    accessToken: connection.accessToken,
    invoice: invoiceResult.Invoice ?? invoiceResult
  });

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      paymentStatus: PaymentStatus.CANCELLED,
      quickBooksInvoiceStatus: QuickBooksInvoiceStatus.VOIDED,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });

  await prisma.paymentRecord.updateMany({
    where: { registrationId: registration.id },
    data: {
      status: PaymentStatus.CANCELLED,
      quickBooksInvoiceStatus: QuickBooksInvoiceStatus.VOIDED,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });

  return { registrationId, invoiceId: registration.quickBooksInvoiceRef, result: voidResult };
}

export async function processQuickBooksWebhook(rawBody: string, signature?: string | null, skipSignature = false) {
  if (!skipSignature && !verifyQuickBooksWebhookSignature(rawBody, signature)) {
    throw Object.assign(new Error("Invalid QuickBooks webhook signature."), { code: "FORBIDDEN", status: 403 });
  }

  const payload = JSON.parse(rawBody || "{}") as Record<string, any>;
  const event = await prisma.webhookEvent.create({
    data: {
      source: "quickbooks",
      eventType: "quickbooks.webhook",
      payload: payload as Prisma.InputJsonValue,
      status: WebhookProcessingStatus.PROCESSING
    }
  });

  try {
    const entities = (payload.eventNotifications ?? [])
      .flatMap((notification: Record<string, any>) =>
        (notification.dataChangeEvent?.entities ?? []).map((entity: Record<string, any>) => ({
          ...entity,
          realmId: notification.realmId
        }))
      )
      .filter((entity: Record<string, any>) => ["Invoice", "Payment"].includes(entity.name));
    const results = [];

    for (const entity of entities) {
      if (entity.name === "Invoice" && entity.id) {
        results.push(await syncQuickBooksInvoice(String(entity.id), entity.realmId ? String(entity.realmId) : undefined));
      }

      if (entity.name === "Payment" && entity.id) {
        results.push(await syncQuickBooksPayment(String(entity.id), entity.realmId ? String(entity.realmId) : undefined));
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
    });

    return { processed: results.length, results };
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: WebhookProcessingStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Unknown QuickBooks webhook error"
      }
    });
    throw error;
  }
}
