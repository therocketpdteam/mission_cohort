import {
  IntegrationConnectionStatus,
  IntegrationJobStatus,
  IntegrationJobType,
  IntegrationProvider,
  Prisma
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, IntegrationCredentialError } from "@/lib/integrationCrypto";

function cleanJson(value?: unknown) {
  return value == null ? undefined : JSON.parse(JSON.stringify(value));
}

export async function upsertIntegrationConnection(input: {
  provider: IntegrationProvider;
  label?: string;
  status?: IntegrationConnectionStatus;
  accountId?: string;
  accountName?: string;
  realmId?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  metadata?: Prisma.InputJsonValue;
  errorMessage?: string | null;
}) {
  const label = input.label ?? "default";

  return prisma.integrationConnection.upsert({
    where: { provider_label: { provider: input.provider, label } },
    update: {
      status: input.status,
      accountId: input.accountId,
      accountName: input.accountName,
      realmId: input.realmId,
      accessToken: input.accessToken ? encryptSecret(input.accessToken) : undefined,
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : undefined,
      tokenExpiresAt: input.tokenExpiresAt,
      metadata: cleanJson(input.metadata),
      errorMessage: input.errorMessage,
      lastSyncedAt: input.status === IntegrationConnectionStatus.CONNECTED ? new Date() : undefined
    },
    create: {
      provider: input.provider,
      label,
      status: input.status ?? IntegrationConnectionStatus.NOT_CONFIGURED,
      accountId: input.accountId,
      accountName: input.accountName,
      realmId: input.realmId,
      accessToken: encryptSecret(input.accessToken),
      refreshToken: encryptSecret(input.refreshToken),
      tokenExpiresAt: input.tokenExpiresAt,
      metadata: cleanJson(input.metadata),
      errorMessage: input.errorMessage,
      lastSyncedAt: input.status === IntegrationConnectionStatus.CONNECTED ? new Date() : undefined
    }
  });
}

export async function getIntegrationConnection(provider: IntegrationProvider, label = "default") {
  return prisma.integrationConnection.findUnique({
    where: { provider_label: { provider, label } }
  });
}

export async function getDecryptedIntegrationConnection(provider: IntegrationProvider, label = "default") {
  const connection = await getIntegrationConnection(provider, label);

  if (!connection) {
    return null;
  }

  return {
    ...connection,
    accessToken: decryptSecret(connection.accessToken),
    refreshToken: decryptSecret(connection.refreshToken)
  };
}

export async function listIntegrationStatuses() {
  const connections = await prisma.integrationConnection.findMany({
    orderBy: [{ provider: "asc" }, { label: "asc" }],
    select: {
      id: true,
      provider: true,
      label: true,
      status: true,
      accountId: true,
      accountName: true,
      realmId: true,
      tokenExpiresAt: true,
      lastSyncedAt: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const encryptedCredentials = await prisma.integrationConnection.findMany({
    select: { id: true, accessToken: true, refreshToken: true }
  });
  const credentialsById = new Map(encryptedCredentials.map((connection) => [connection.id, connection]));

  return connections.map((connection) => {
    const credentials = credentialsById.get(connection.id);
    const hasStoredCredentials = Boolean(credentials?.accessToken || credentials?.refreshToken);

    if (!hasStoredCredentials) {
      return { ...connection, credentialHealth: "NOT_STORED" as const, credentialError: null };
    }

    try {
      decryptSecret(credentials?.accessToken);
      decryptSecret(credentials?.refreshToken);
      return { ...connection, credentialHealth: "READABLE" as const, credentialError: null };
    } catch (error) {
      return {
        ...connection,
        credentialHealth: "UNREADABLE" as const,
        credentialError: error instanceof IntegrationCredentialError ? error.message : "Credential validation failed."
      };
    }
  });
}

export async function queueIntegrationJob(input: {
  provider: IntegrationProvider;
  type: IntegrationJobType;
  connectionId?: string;
  entityType?: string;
  entityId?: string;
  payload?: Prisma.InputJsonValue;
  runAfter?: Date;
}) {
  return prisma.integrationSyncJob.create({
    data: {
      provider: input.provider,
      type: input.type,
      connectionId: input.connectionId,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: cleanJson(input.payload),
      runAfter: input.runAfter ?? new Date()
    }
  });
}

export async function listIntegrationJobs(status?: IntegrationJobStatus) {
  return prisma.integrationSyncJob.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      connection: {
        select: {
          id: true,
          provider: true,
          label: true,
          status: true,
          accountId: true,
          accountName: true,
          realmId: true,
          lastSyncedAt: true,
          errorMessage: true
        }
      }
    }
  });
}

export async function markIntegrationJobCompleted(id: string, result?: unknown) {
  return prisma.integrationSyncJob.update({
    where: { id },
    data: {
      status: IntegrationJobStatus.COMPLETED,
      result: cleanJson(result),
      processedAt: new Date()
    }
  });
}

export async function markIntegrationJobFailed(id: string, error: unknown) {
  return prisma.integrationSyncJob.update({
    where: { id },
    data: {
      status: IntegrationJobStatus.FAILED,
      attempts: { increment: 1 },
      errorMessage: error instanceof Error ? error.message : "Unknown integration job error",
      processedAt: new Date()
    }
  });
}
