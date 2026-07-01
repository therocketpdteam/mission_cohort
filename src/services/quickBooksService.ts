import {
  IntegrationConnectionStatus,
  IntegrationProvider,
  InvoiceDraftStatus,
  PaymentStatus,
  QuickBooksInvoiceStatus,
  SyncStatus,
  WebhookProcessingStatus
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createQuickBooksInvoice,
  createQuickBooksProject,
  exchangeQuickBooksCode,
  fetchQuickBooksInvoice,
  findQuickBooksInvoiceByDocNumber,
  findQuickBooksProject,
  getQuickBooksConnectUrl,
  refreshQuickBooksToken,
  verifyQuickBooksWebhookSignature,
  voidQuickBooksInvoice
} from "@/modules/quickbooks";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";
import { resolveQuickBooksSetup } from "@/services/integrationSetupService";

async function quickBooksSetupWithEnvFallback() {
  const setup = await resolveQuickBooksSetup();

  return {
    clientId: setup.clientId || undefined,
    clientSecret: setup.clientSecret || undefined,
    redirectUri: setup.redirectUri || undefined,
    webhookVerifierToken: setup.webhookVerifierToken || undefined,
    environment: setup.environment || undefined,
    parentCustomerRef: setup.parentCustomerRef || undefined,
    serviceItemRef: setup.serviceItemRef || undefined
  };
}

export async function getQuickBooksOAuthUrl() {
  return getQuickBooksConnectUrl("mission-control", await quickBooksSetupWithEnvFallback());
}

export async function completeQuickBooksOAuth(code: string, realmId?: string | null) {
  const setup = await quickBooksSetupWithEnvFallback();
  const token = await exchangeQuickBooksCode(code, setup);
  return upsertIntegrationConnection({
    provider: IntegrationProvider.QUICKBOOKS,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "QuickBooks Online",
    realmId: realmId ?? undefined,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    metadata: { refreshTokenExpiresIn: token.x_refresh_token_expires_in ?? null, environment: setup.environment ?? null }
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

function paymentStatusFromInvoice(invoice: Record<string, any>, status: QuickBooksInvoiceStatus) {
  if (status === QuickBooksInvoiceStatus.PAID) {
    return PaymentStatus.PAID;
  }

  if (status === QuickBooksInvoiceStatus.VOIDED || status === QuickBooksInvoiceStatus.CANCELLED) {
    return PaymentStatus.CANCELLED;
  }

  const totalAmount = Number(invoice.TotalAmt ?? 0);
  const balance = Number(invoice.Balance ?? 0);
  if (totalAmount > 0 && balance > 0 && balance < totalAmount) {
    return PaymentStatus.PARTIALLY_PAID;
  }

  return PaymentStatus.INVOICED;
}

function toQuickBooksDate(value?: Date | string | null) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

function moneyNumber(value: unknown) {
  return Number(value ?? 0);
}

async function quickBooksConnection() {
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.QUICKBOOKS);

  if (!connection?.accessToken) {
    throw Object.assign(new Error("QuickBooks is not connected."), { code: "BAD_REQUEST", status: 400 });
  }

  if (!connection.realmId) {
    throw Object.assign(new Error("QuickBooks realm ID is missing."), { code: "BAD_REQUEST", status: 400 });
  }

  const setup = await quickBooksSetupWithEnvFallback();
  let accessToken = connection.accessToken;
  let refreshToken = connection.refreshToken;

  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now() + 60_000) {
    if (!refreshToken) {
      throw Object.assign(new Error("QuickBooks refresh token is missing. Reconnect QuickBooks."), { code: "BAD_REQUEST", status: 400 });
    }

    const refreshed = await refreshQuickBooksToken(refreshToken, setup);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token ?? refreshToken;
    await upsertIntegrationConnection({
      provider: IntegrationProvider.QUICKBOOKS,
      status: IntegrationConnectionStatus.CONNECTED,
      accountName: connection.accountName ?? "QuickBooks Online",
      realmId: connection.realmId,
      accessToken,
      refreshToken,
      tokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : undefined,
      metadata: { ...(connection.metadata as Record<string, unknown> ?? {}), environment: setup.environment ?? null }
    });
  }

  return { connection, setup, realmId: connection.realmId, accessToken };
}

function requireProjectSetup(setup: Awaited<ReturnType<typeof quickBooksSetupWithEnvFallback>>) {
  if (!setup.parentCustomerRef) {
    throw Object.assign(new Error("QuickBooks RocketPD parent customer ref is required in Settings > Connected Tools."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return setup.parentCustomerRef;
}

function requireInvoiceSetup(setup: Awaited<ReturnType<typeof quickBooksSetupWithEnvFallback>>) {
  if (!setup.serviceItemRef) {
    throw Object.assign(new Error("QuickBooks service item ref is required in Settings > Connected Tools."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return setup.serviceItemRef;
}

export async function ensureCohortQuickBooksProject(cohortId: string) {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } });

  if (!cohort) {
    throw Object.assign(new Error("Cohort not found."), { code: "NOT_FOUND", status: 404 });
  }

  const projectName = (cohort.shortName || cohort.title).trim();
  if (!projectName) {
    throw Object.assign(new Error("Cohort short name is required to create a QuickBooks project."), { code: "BAD_REQUEST", status: 400 });
  }

  const { setup, realmId, accessToken } = await quickBooksConnection();
  const parentCustomerRef = requireProjectSetup(setup);

  try {
    const existing = await findQuickBooksProject({
      realmId,
      accessToken,
      parentCustomerRef,
      projectName,
      environment: setup.environment
    });
    const project = existing ?? await createQuickBooksProject({
      realmId,
      accessToken,
      parentCustomerRef,
      projectName,
      environment: setup.environment
    });

    return prisma.cohort.update({
      where: { id: cohort.id },
      data: {
        quickBooksProjectRef: String(project.Id ?? project.id),
        quickBooksProjectName: String(project.DisplayName ?? projectName),
        quickBooksParentCustomerRef: parentCustomerRef,
        quickBooksRealmId: realmId,
        quickBooksSyncStatus: SyncStatus.SYNCED,
        quickBooksSyncError: null,
        quickBooksLastSyncedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.cohort.update({
      where: { id: cohort.id },
      data: {
        quickBooksProjectName: projectName,
        quickBooksParentCustomerRef: parentCustomerRef,
        quickBooksRealmId: realmId,
        quickBooksSyncStatus: SyncStatus.ERROR,
        quickBooksSyncError: error instanceof Error ? error.message : "QuickBooks project sync failed.",
        quickBooksLastSyncedAt: new Date()
      }
    });
    throw error;
  }
}

async function tryEnsureCohortQuickBooksProject(cohortId: string) {
  try {
    return await ensureCohortQuickBooksProject(cohortId);
  } catch (error) {
    return prisma.cohort.update({
      where: { id: cohortId },
      data: {
        quickBooksSyncStatus: SyncStatus.ERROR,
        quickBooksSyncError: error instanceof Error ? error.message : "QuickBooks project sync failed.",
        quickBooksLastSyncedAt: new Date()
      }
    }).catch(() => null);
  }
}

export async function syncCohortQuickBooksProjectAfterCreate(cohortId: string) {
  const setup = await quickBooksSetupWithEnvFallback();
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.QUICKBOOKS);

  if (!setup.parentCustomerRef || !connection?.accessToken || !connection.realmId) {
    await prisma.cohort.update({
      where: { id: cohortId },
      data: {
        quickBooksSyncStatus: SyncStatus.PENDING,
        quickBooksSyncError: setup.parentCustomerRef
          ? "Connect QuickBooks to create the cohort project."
          : "Configure the RocketPD parent customer ref in Settings > Connected Tools.",
        quickBooksLastSyncedAt: new Date()
      }
    }).catch(() => null);
    return null;
  }

  return tryEnsureCohortQuickBooksProject(cohortId);
}

function quickBooksInvoiceDescription(invoice: {
  cohort: { title: string; description?: string | null };
  registration?: {
    primaryContactName?: string | null;
    primaryContactEmail?: string | null;
    participantCount?: number | null;
    organization?: { name?: string | null } | null;
  } | null;
  organization?: { name?: string | null } | null;
  purchaseOrderNumber?: string | null;
}) {
  const organization = invoice.organization ?? invoice.registration?.organization;
  return [
    organization?.name ? `Organization: ${organization.name}` : null,
    `Cohort: ${invoice.cohort.title}`,
    invoice.cohort.description,
    invoice.registration ? `Registration: ${invoice.registration.primaryContactName} <${invoice.registration.primaryContactEmail}>` : null,
    invoice.registration ? `Participants: ${invoice.registration.participantCount}` : null,
    invoice.purchaseOrderNumber ? `PO: ${invoice.purchaseOrderNumber}` : null
  ].filter(Boolean).join("\n");
}

export async function createQuickBooksInvoiceFromDraft(invoiceDraftId: string) {
  let invoice = await prisma.invoiceDraft.findUniqueOrThrow({
    where: { id: invoiceDraftId },
    include: {
      cohort: true,
      registration: { include: { organization: true } },
      organization: true,
      lineItems: true
    }
  });

  if (invoice.quickBooksInvoiceRef) {
    return { invoice, quickBooksInvoiceId: invoice.quickBooksInvoiceRef, reused: true };
  }

  if (invoice.registration?.archivedAt) {
    throw Object.assign(new Error("Archived registrations cannot be sent to QuickBooks."), { code: "BAD_REQUEST", status: 400 });
  }

  const { setup, realmId, accessToken } = await quickBooksConnection();
  const serviceItemRef = requireInvoiceSetup(setup);
  const cohortProject = invoice.cohort.quickBooksProjectRef
    ? invoice.cohort
    : await ensureCohortQuickBooksProject(invoice.cohortId);
  const projectRef = cohortProject.quickBooksProjectRef;

  if (!projectRef) {
    throw Object.assign(new Error("QuickBooks project ref is missing for this cohort."), { code: "BAD_REQUEST", status: 400 });
  }

  const docNumber = invoice.invoiceNumber ?? invoice.id.slice(-8);
  const existing = await findQuickBooksInvoiceByDocNumber({
    realmId,
    accessToken,
    docNumber,
    environment: setup.environment
  });

  const qbInvoice = existing ?? await createQuickBooksInvoice({
    realmId,
    accessToken,
    environment: setup.environment,
    invoice: {
      DocNumber: docNumber,
      CustomerRef: { value: projectRef },
      TxnDate: toQuickBooksDate(invoice.issueDate),
      DueDate: toQuickBooksDate(invoice.dueDate),
      BillEmail: invoice.registration?.billingContactEmail || invoice.registration?.primaryContactEmail
        ? { Address: invoice.registration?.billingContactEmail || invoice.registration?.primaryContactEmail }
        : undefined,
      PrivateNote: `Mission Control invoice ${invoice.id}${invoice.registrationId ? ` / registration ${invoice.registrationId}` : ""}`,
      CustomerMemo: { value: quickBooksInvoiceDescription(invoice) },
      Line: invoice.lineItems.map((item) => ({
        DetailType: "SalesItemLineDetail",
        Amount: moneyNumber(item.totalAmount),
        Description: item.description,
        SalesItemLineDetail: {
          ItemRef: { value: serviceItemRef },
          Qty: Number(item.quantity ?? 1),
          UnitPrice: moneyNumber(item.unitAmount)
        }
      }))
    }
  });

  const invoiceStatus = invoiceStatusFromQuickBooks(qbInvoice);
  const paymentStatus = paymentStatusFromInvoice(qbInvoice, invoiceStatus);
  invoice = await prisma.invoiceDraft.update({
    where: { id: invoice.id },
    data: {
      quickBooksCustomerRef: projectRef,
      quickBooksInvoiceRef: String(qbInvoice.Id ?? qbInvoice.id),
      quickBooksRealmId: realmId,
      quickBooksInvoiceStatus: invoiceStatus,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    },
    include: {
      cohort: true,
      registration: { include: { organization: true } },
      organization: true,
      lineItems: true
    }
  });

  if (invoice.registrationId) {
    await prisma.registration.update({
      where: { id: invoice.registrationId },
      data: {
        paymentStatus,
        quickBooksCustomerRef: projectRef,
        quickBooksInvoiceRef: String(qbInvoice.Id ?? qbInvoice.id),
        quickBooksRealmId: realmId,
        quickBooksInvoiceStatus: invoiceStatus,
        quickBooksSyncStatus: SyncStatus.SYNCED,
        quickBooksSyncError: null,
        quickBooksLastSyncedAt: new Date()
      }
    });
  }

  const paymentWhere: Prisma.PaymentRecordWhereInput | null = invoice.registrationId
    ? { registrationId: invoice.registrationId }
    : invoice.invoiceNumber
      ? { invoiceNumber: invoice.invoiceNumber }
      : null;

  if (paymentWhere) {
    await prisma.paymentRecord.updateMany({
      where: paymentWhere,
      data: {
        quickBooksInvoiceRef: String(qbInvoice.Id ?? qbInvoice.id),
        quickBooksRealmId: realmId,
        quickBooksInvoiceStatus: invoiceStatus,
        quickBooksSyncStatus: SyncStatus.SYNCED,
        quickBooksSyncError: null,
        quickBooksLastSyncedAt: new Date()
      }
    });
  }

  return { invoice, quickBooksInvoiceId: String(qbInvoice.Id ?? qbInvoice.id), reused: Boolean(existing) };
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
    invoiceId,
    environment: (await quickBooksSetupWithEnvFallback()).environment
  });
  const invoice = result.Invoice ?? result;
  const invoiceStatus = invoiceStatusFromQuickBooks(invoice);
  const paymentStatus = paymentStatusFromInvoice(invoice, invoiceStatus);
  const paidAmount = Math.max(Number(invoice.TotalAmt ?? 0) - Number(invoice.Balance ?? 0), 0);
  const invoiceDrafts = await prisma.invoiceDraft.updateMany({
    where: { quickBooksInvoiceRef: invoiceId },
    data: {
      paidAmount,
      status: invoiceStatus === QuickBooksInvoiceStatus.PAID
        ? InvoiceDraftStatus.PAID
        : invoiceStatus === QuickBooksInvoiceStatus.VOIDED
          ? InvoiceDraftStatus.VOIDED
          : undefined,
      quickBooksRealmId: resolvedRealmId,
      quickBooksInvoiceStatus: invoiceStatus,
      quickBooksSyncStatus: SyncStatus.SYNCED,
      quickBooksSyncError: null,
      quickBooksLastSyncedAt: new Date()
    }
  });
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

  return { invoiceId, invoiceStatus, paymentStatus, invoiceDrafts: invoiceDrafts.count, registrations: registrations.count, payments: payments.count };
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
    invoiceId: registration.quickBooksInvoiceRef,
    environment: (await quickBooksSetupWithEnvFallback()).environment
  });
  const voidResult = await voidQuickBooksInvoice({
    realmId,
    accessToken: connection.accessToken,
    invoice: invoiceResult.Invoice ?? invoiceResult,
    environment: (await quickBooksSetupWithEnvFallback()).environment
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
  if (!skipSignature && !verifyQuickBooksWebhookSignature(rawBody, signature, await quickBooksSetupWithEnvFallback())) {
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
