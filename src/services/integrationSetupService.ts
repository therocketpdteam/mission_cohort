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

function cleanRecipientEmails(value: unknown) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[\n,;]/);
  return Array.from(new Set(values
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item.includes("@"))));
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
    webhookPublicKey: "",
    liveSendingEnabled: data.liveSendingEnabled === true,
    testRecipientEmails: cleanRecipientEmails(data.testRecipientEmails),
    hasApiKey: maskedSecret(connection?.accessToken),
    hasWebhookPublicKey: maskedSecret(String(data.webhookPublicKey ?? "")),
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
    clientId: "",
    redirectUri: String(data.redirectUri ?? ""),
    calendarId: String(data.calendarId ?? ""),
    liveSendingEnabled: data.liveSendingEnabled === true,
    testRecipientEmails: cleanRecipientEmails(data.testRecipientEmails),
    hasClientSecret: maskedSecret(setup?.accessToken),
    hasClientId: maskedSecret(setup?.accountId),
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
    clientId: "",
    redirectUri: String(data.redirectUri ?? ""),
    environment: String(data.environment ?? "sandbox"),
    hasClientSecret: maskedSecret(setup?.accessToken),
    hasClientId: maskedSecret(setup?.accountId),
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
    const webhookPublicKey = cleanString(input.webhookPublicKey) || String(existingMetadata.webhookPublicKey ?? "");
    const testRecipientEmails = cleanRecipientEmails(input.testRecipientEmails ?? existingMetadata.testRecipientEmails);
    const liveSendingEnabled = input.liveSendingEnabled === true;

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
        webhookPublicKey,
        testRecipientEmails,
        liveSendingEnabled
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
    const testRecipientEmails = cleanRecipientEmails(input.testRecipientEmails ?? existingMetadata.testRecipientEmails);
    const liveSendingEnabled = input.liveSendingEnabled === true;

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
        ...(calendarId ? { calendarId } : {}),
        testRecipientEmails,
        liveSendingEnabled
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

export async function assertOutboundRecipientsAllowed(provider: "SENDGRID" | "GOOGLE_CALENDAR", recipients: string[]) {
  const setup = provider === "SENDGRID" ? await getSendGridSetup() : await getGoogleCalendarSetup();
  const normalized = Array.from(new Set(recipients.map((email) => email.trim().toLowerCase()).filter(Boolean)));

  if (setup.liveSendingEnabled || normalized.length === 0) {
    return;
  }

  const allowed = new Set(setup.testRecipientEmails);
  const blocked = normalized.filter((email) => !allowed.has(email));

  if (blocked.length > 0) {
    throw Object.assign(new Error(
      `Outbound safety mode blocked ${blocked.length} ${provider === "SENDGRID" ? "email" : "calendar"} recipient${blocked.length === 1 ? "" : "s"}. Add test recipients in Settings > Connected Tools or explicitly enable live sending.`
    ), { code: "BAD_REQUEST", status: 400 });
  }
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
