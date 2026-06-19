import { IntegrationConnectionStatus, IntegrationProvider } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { decryptSecret } from "@/lib/integrationCrypto";
import { prisma } from "@/lib/prisma";
import { upsertIntegrationConnection } from "@/services/integrationService";

type IntegrationSetupProvider = "SENDGRID" | "GOOGLE_CALENDAR" | "QUICKBOOKS";

function metadata(value: unknown) {
  return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
}

function maskedSecret(value?: string | null) {
  if (!value) {
    return false;
  }

  return true;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getConnection(provider: IntegrationProvider, label = "default") {
  return prisma.integrationConnection.findUnique({
    where: { provider_label: { provider, label } }
  }).catch(() => null);
}

export async function getSendGridSetup() {
  const connection = await getConnection(IntegrationProvider.SENDGRID);
  const data = metadata(connection?.metadata);

  return {
    provider: "SENDGRID",
    configured: Boolean(connection?.accessToken && data.fromEmail),
    fromEmail: String(data.fromEmail ?? ""),
    fromName: String(data.fromName ?? connection?.accountName ?? ""),
    webhookPublicKey: String(data.webhookPublicKey ?? ""),
    hasApiKey: maskedSecret(connection?.accessToken),
    status: connection?.status ?? IntegrationConnectionStatus.NOT_CONFIGURED,
    updatedAt: connection?.updatedAt ?? null
  };
}

export async function getGoogleCalendarSetup() {
  const setup = await getConnection(IntegrationProvider.GOOGLE_CALENDAR, "setup");
  const connection = await getConnection(IntegrationProvider.GOOGLE_CALENDAR, "default");
  const data = metadata(setup?.metadata);

  return {
    provider: "GOOGLE_CALENDAR",
    configured: Boolean(setup?.accountId && setup?.accessToken && data.redirectUri && data.calendarId),
    clientId: setup?.accountId ?? "",
    redirectUri: String(data.redirectUri ?? ""),
    calendarId: String(data.calendarId ?? ""),
    hasClientSecret: maskedSecret(setup?.accessToken),
    status: setup?.status ?? IntegrationConnectionStatus.NOT_CONFIGURED,
    connectedAccount: connection ? {
      status: connection.status,
      accountName: connection.accountName,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastSyncedAt: connection.lastSyncedAt,
      errorMessage: connection.errorMessage
    } : null,
    updatedAt: setup?.updatedAt ?? null
  };
}

export async function getQuickBooksSetup() {
  const setup = await getConnection(IntegrationProvider.QUICKBOOKS, "setup");
  const connection = await getConnection(IntegrationProvider.QUICKBOOKS, "default");
  const data = metadata(setup?.metadata);

  return {
    provider: "QUICKBOOKS",
    configured: Boolean(setup?.accountId && setup?.accessToken && data.redirectUri && setup?.refreshToken),
    clientId: setup?.accountId ?? "",
    redirectUri: String(data.redirectUri ?? ""),
    environment: String(data.environment ?? "sandbox"),
    hasClientSecret: maskedSecret(setup?.accessToken),
    hasWebhookVerifierToken: maskedSecret(setup?.refreshToken),
    status: setup?.status ?? IntegrationConnectionStatus.NOT_CONFIGURED,
    connectedAccount: connection ? {
      status: connection.status,
      accountName: connection.accountName,
      realmId: connection.realmId,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastSyncedAt: connection.lastSyncedAt,
      errorMessage: connection.errorMessage
    } : null,
    updatedAt: setup?.updatedAt ?? null
  };
}

export async function getIntegrationSetups() {
  return {
    sendgrid: await getSendGridSetup(),
    googleCalendar: await getGoogleCalendarSetup(),
    quickBooks: await getQuickBooksSetup()
  };
}

export async function saveIntegrationSetup(provider: IntegrationSetupProvider, input: Record<string, unknown>) {
  if (!["SENDGRID", "GOOGLE_CALENDAR", "QUICKBOOKS"].includes(provider)) {
    throw Object.assign(new Error("Unsupported integration setup provider."), { code: "BAD_REQUEST", status: 400 });
  }

  if (provider === "SENDGRID") {
    const existing = await getConnection(IntegrationProvider.SENDGRID);
    const existingMetadata = metadata(existing?.metadata);
    const apiKey = cleanString(input.apiKey);
    const fromEmail = cleanString(input.fromEmail) || String(existingMetadata.fromEmail ?? "");
    const fromName = cleanString(input.fromName);
    const webhookPublicKey = cleanString(input.webhookPublicKey);

    if (!fromEmail) {
      throw Object.assign(new Error("SendGrid from email is required."), { code: "BAD_REQUEST", status: 400 });
    }

    if (!apiKey && !existing?.accessToken) {
      throw Object.assign(new Error("SendGrid API key is required the first time you configure SendGrid."), { code: "BAD_REQUEST", status: 400 });
    }

    await upsertIntegrationConnection({
      provider: IntegrationProvider.SENDGRID,
      label: "default",
      status: IntegrationConnectionStatus.CONNECTED,
      accountName: fromName || fromEmail,
      accessToken: apiKey || decryptSecret(existing?.accessToken),
      metadata: {
        ...existingMetadata,
        fromEmail,
        fromName,
        webhookPublicKey
      } as Prisma.InputJsonValue
    });

    return getSendGridSetup();
  }

  if (provider === "GOOGLE_CALENDAR") {
    const existing = await getConnection(IntegrationProvider.GOOGLE_CALENDAR, "setup");
    const existingMetadata = metadata(existing?.metadata);
    const clientId = cleanString(input.clientId) || existing?.accountId || "";
    const clientSecret = cleanString(input.clientSecret);
    const redirectUri = cleanString(input.redirectUri) || String(existingMetadata.redirectUri ?? "");
    const calendarId = cleanString(input.calendarId) || String(existingMetadata.calendarId ?? "");

    if (!clientId || !redirectUri) {
      throw Object.assign(new Error("Google client ID and redirect URI are required."), { code: "BAD_REQUEST", status: 400 });
    }

    if (!clientSecret && !existing?.accessToken) {
      throw Object.assign(new Error("Google client secret is required the first time you configure Google Calendar."), { code: "BAD_REQUEST", status: 400 });
    }

    await upsertIntegrationConnection({
      provider: IntegrationProvider.GOOGLE_CALENDAR,
      label: "setup",
      status: IntegrationConnectionStatus.CONNECTED,
      accountId: clientId,
      accountName: "Google Calendar OAuth app",
      accessToken: clientSecret || decryptSecret(existing?.accessToken),
      metadata: {
        ...existingMetadata,
        redirectUri,
        ...(calendarId ? { calendarId } : {})
      } as Prisma.InputJsonValue
    });

    return getGoogleCalendarSetup();
  }

  const existing = await getConnection(IntegrationProvider.QUICKBOOKS, "setup");
  const existingMetadata = metadata(existing?.metadata);
  const clientId = cleanString(input.clientId) || existing?.accountId || "";
  const clientSecret = cleanString(input.clientSecret);
  const redirectUri = cleanString(input.redirectUri) || String(existingMetadata.redirectUri ?? "");
  const environment = cleanString(input.environment) || String(existingMetadata.environment ?? "sandbox");
  const webhookVerifierToken = cleanString(input.webhookVerifierToken);

  if (!clientId || !redirectUri) {
    throw Object.assign(new Error("QuickBooks client ID and redirect URI are required."), { code: "BAD_REQUEST", status: 400 });
  }

  if (!clientSecret && !existing?.accessToken) {
    throw Object.assign(new Error("QuickBooks client secret is required the first time you configure QuickBooks."), { code: "BAD_REQUEST", status: 400 });
  }

  if (!webhookVerifierToken && !existing?.refreshToken) {
    throw Object.assign(new Error("QuickBooks webhook verifier token is required the first time you configure QuickBooks."), { code: "BAD_REQUEST", status: 400 });
  }

  await upsertIntegrationConnection({
    provider: IntegrationProvider.QUICKBOOKS,
    label: "setup",
    status: IntegrationConnectionStatus.CONNECTED,
    accountId: clientId,
    accountName: "QuickBooks OAuth app",
    accessToken: clientSecret || decryptSecret(existing?.accessToken),
    refreshToken: webhookVerifierToken || decryptSecret(existing?.refreshToken),
    metadata: {
      ...existingMetadata,
      redirectUri,
      environment
    } as Prisma.InputJsonValue
  });

  return getQuickBooksSetup();
}

export async function resolveGoogleCalendarSetup() {
  const setup = await getConnection(IntegrationProvider.GOOGLE_CALENDAR, "setup");
  const data = metadata(setup?.metadata);

  return {
    clientId: setup?.accountId,
    clientSecret: decryptSecret(setup?.accessToken),
    redirectUri: String(data.redirectUri ?? ""),
    calendarId: String(data.calendarId ?? "")
  };
}

export async function resolveQuickBooksSetup() {
  const setup = await getConnection(IntegrationProvider.QUICKBOOKS, "setup");
  const data = metadata(setup?.metadata);

  return {
    clientId: setup?.accountId,
    clientSecret: decryptSecret(setup?.accessToken),
    redirectUri: String(data.redirectUri ?? ""),
    webhookVerifierToken: decryptSecret(setup?.refreshToken),
    environment: String(data.environment ?? "sandbox")
  };
}
