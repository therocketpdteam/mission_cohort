import { env, getEnvPresence } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getGoogleCalendarSetup, getQuickBooksSetup, getSendGridSetup } from "@/services/integrationSetupService";

export type HealthStatus = "healthy" | "warning" | "blocked";

export type HealthCheck = {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  nextAction?: string;
};

export type HealthGroup = {
  key: string;
  title: string;
  summary: string;
  status: HealthStatus;
  checks: HealthCheck[];
};

export type SystemHealth = {
  status: HealthStatus;
  generatedAt: string;
  database: boolean;
  groups: HealthGroup[];
};

type SchemaRequirement = {
  key: string;
  label: string;
  detail: string;
  nextAction: string;
  tables?: string[];
  columns?: Array<[string, string]>;
};

const requiredSchema: SchemaRequirement[] = [
  {
    key: "communicationReview",
    label: "Communications issue review",
    detail: "Stores reviewed failed/bounced recipient events.",
    nextAction: "Run the 20260605143000 communication issue review migration.",
    columns: [
      ["EmailEvent", "reviewedAt"],
      ["EmailEvent", "reviewedById"],
      ["EmailEvent", "reviewNote"]
    ]
  },
  {
    key: "jotformRevision",
    label: "Jotform revision history",
    detail: "Links resubmitted Jotform events to active registrations.",
    nextAction: "Run the 20260603170000 Jotform revision metadata migration.",
    columns: [
      ["WebhookEvent", "registrationId"],
      ["WebhookEvent", "externalSubmissionId"],
      ["WebhookEvent", "revisionNumber"],
      ["WebhookEvent", "normalizedSummary"]
    ]
  },
  {
    key: "registrationJourneys",
    label: "Registration communication journeys",
    detail: "Links deduplicated POC and participant messages to registrations.",
    nextAction: "Run the 20260622120000 registration communication journeys migration.",
    columns: [
      ["CohortCommunication", "registrationId"],
      ["CohortCommunication", "participantId"],
      ["CohortCommunication", "journeyKey"]
    ]
  },
  {
    key: "registrationChangeControl",
    label: "Registration change control",
    detail: "Stores participant and finance changes until delivery is applied.",
    nextAction: "Run the 20260622170000 registration change control migration.",
    columns: [
      ["Registration", "pendingChanges"],
      ["Registration", "pendingChangesAt"]
    ]
  },
  {
    key: "invoiceDrafts",
    label: "Invoice drafts",
    detail: "Supports editable invoice/receipt documents.",
    nextAction: "Run the 20260602120000 operational finance migration.",
    tables: ["InvoiceDraft", "InvoiceLineItem"]
  },
  {
    key: "distributionLedger",
    label: "Distribution ledger",
    detail: "Tracks TL share, payout records, and project return.",
    nextAction: "Run the 20260602120000 operational finance migration.",
    tables: ["CohortDistribution", "DistributionPayout"]
  },
  {
    key: "storageAttachments",
    label: "Storage-backed files",
    detail: "Supports email attachments, materials, invoices, receipts, and cohort thumbnails.",
    nextAction: "Run the storage/resource migration and verify Supabase buckets.",
    tables: ["CommunicationAttachment", "CohortResource"],
    columns: [
      ["Cohort", "thumbnailUrl"],
      ["CohortResource", "fileKey"],
      ["CommunicationAttachment", "fileKey"]
    ]
  }
];

function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }

  if (statuses.includes("warning")) {
    return "warning";
  }

  return "healthy";
}

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

async function columnExists(tableName: string, columnName: string) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

async function databaseCheck(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      key: "database",
      label: "Database connection",
      status: "healthy",
      detail: "Prisma can reach the configured database."
    };
  } catch (error) {
    return {
      key: "database",
      label: "Database connection",
      status: "blocked",
      detail: "Prisma could not reach the configured database.",
      nextAction: String((error as Error).message ?? "Verify DATABASE_URL and network access.")
    };
  }
}

async function schemaChecks(databaseReady: boolean): Promise<HealthCheck[]> {
  if (!databaseReady) {
    return requiredSchema.map((check) => ({
      key: check.key,
      label: check.label,
      status: "blocked",
      detail: "Skipped because the database is unavailable.",
      nextAction: "Restore database connectivity first."
    }));
  }

  return Promise.all(requiredSchema.map(async (check) => {
    const tableResults = await Promise.all((check.tables ?? []).map((table) => tableExists(table)));
    const columnResults = await Promise.all((check.columns ?? []).map(([table, column]) => columnExists(table, column)));
    const missingTables = (check.tables ?? []).filter((_table, index) => !tableResults[index]);
    const missingColumns = (check.columns ?? []).filter((_column, index) => !columnResults[index]).map(([table, column]) => `${table}.${column}`);
    const missing = [...missingTables, ...missingColumns];

    return {
      key: check.key,
      label: check.label,
      status: missing.length > 0 ? "blocked" : "healthy",
      detail: missing.length > 0 ? `${check.detail} Missing: ${missing.join(", ")}.` : check.detail,
      nextAction: missing.length > 0 ? check.nextAction : undefined
    };
  }));
}

async function bucketCheck(bucket: string, label: string): Promise<HealthCheck> {
  try {
    const supabase = createSupabaseAdminClient();
    const result = await supabase.storage.getBucket(bucket);

    if (result.error) {
      return {
        key: bucket,
        label,
        status: "blocked",
        detail: result.error.message,
        nextAction: "Create or repair the Supabase Storage bucket, then retry uploads."
      };
    }

    return {
      key: bucket,
      label,
      status: "healthy",
      detail: `Bucket ${bucket} is available.`
    };
  } catch (error) {
    return {
      key: bucket,
      label,
      status: "blocked",
      detail: String((error as Error).message ?? "Supabase bucket check failed."),
      nextAction: "Verify Supabase URL and service role key."
    };
  }
}

async function storageChecks(): Promise<HealthCheck[]> {
  const presence = getEnvPresence();

  if (!presence.supabaseStorageConfigured) {
    return [
      {
        key: "storageEnv",
        label: "Supabase Storage environment",
        status: "blocked",
        detail: "Supabase URL or service role key is missing.",
        nextAction: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in production."
      }
    ];
  }

  const publicBucket = env.SUPABASE_PUBLIC_BUCKET ?? "mission-control-public";
  const privateBucket = env.SUPABASE_PRIVATE_BUCKET ?? "mission-control-private";

  return [
    {
      key: "storageEnv",
      label: "Supabase Storage environment",
      status: "healthy",
      detail: "Supabase Storage credentials are present."
    },
    await bucketCheck(publicBucket, "Public uploads bucket"),
    await bucketCheck(privateBucket, "Private files bucket")
  ];
}

async function integrationChecks(): Promise<HealthCheck[]> {
  const presence = getEnvPresence();
  const sendGridSetup = await getSendGridSetup();
  const googleSetup = await getGoogleCalendarSetup();
  const quickBooksSetup = await getQuickBooksSetup();
  const googleConnection = await prisma.integrationConnection.findUnique({
    where: { provider_label: { provider: "GOOGLE_CALENDAR", label: "default" } },
    select: { status: true, accountName: true, tokenExpiresAt: true, errorMessage: true }
  }).catch(() => null);
  const googleConnected = googleConnection?.status === "CONNECTED";
  const checks: HealthCheck[] = [
    {
      key: "supabaseAuth",
      label: "Supabase Auth",
      status: presence.supabaseUrl && presence.supabaseAnonKey && presence.supabaseServiceRoleKey ? "healthy" : "blocked",
      detail: presence.supabaseUrl && presence.supabaseAnonKey && presence.supabaseServiceRoleKey
        ? "Authentication credentials are present."
        : "Authentication requires Supabase URL, anon key, and service role key.",
      nextAction: presence.supabaseUrl && presence.supabaseAnonKey && presence.supabaseServiceRoleKey ? undefined : "Add the missing Supabase environment variables in Vercel."
    },
    {
      key: "sendgrid",
      label: "SendGrid email sending",
      status: sendGridSetup.configured || presence.sendgridConfigured ? "healthy" : "warning",
      detail: sendGridSetup.configured
        ? `SendGrid is configured in the app for ${sendGridSetup.fromEmail}.`
        : presence.sendgridConfigured
          ? "SENDGRID_API_KEY and SENDGRID_FROM_EMAIL are present in the environment. Use Connected Tools to move setup into the app."
          : "Outbound email requires a SendGrid API key and from email.",
      nextAction: sendGridSetup.configured || presence.sendgridConfigured ? "Send a diagnostic email from Settings > Connected Tools." : "Configure SendGrid in Settings > Connected Tools."
    },
    {
      key: "sendgridWebhook",
      label: "SendGrid webhook telemetry",
      status: sendGridSetup.hasWebhookPublicKey || presence.sendgridWebhookConfigured ? "healthy" : "warning",
      detail: sendGridSetup.hasWebhookPublicKey
        ? "SendGrid webhook public key is saved in the app."
        : presence.sendgridWebhookConfigured
          ? "Webhook public key is present in the environment."
          : "Delivery/open/error telemetry requires the SendGrid Event Webhook public key.",
      nextAction: sendGridSetup.hasWebhookPublicKey || presence.sendgridWebhookConfigured ? undefined : "Save the SendGrid webhook public key and point SendGrid Event Webhook to /api/webhooks/sendgrid."
    },
    {
      key: "googleCalendarEnv",
      label: "Google Calendar OAuth environment",
      status: googleSetup.configured || presence.googleCalendarConfigured ? "healthy" : "warning",
      detail: googleSetup.configured
        ? "Google Calendar OAuth setup is saved in the app."
        : presence.googleCalendarConfigured
          ? "Google Calendar OAuth setup is present in the environment. Use Connected Tools to move setup into the app."
          : "Calendar automation requires Google Calendar client ID, secret, redirect URI, and calendar ID.",
      nextAction: googleSetup.configured || presence.googleCalendarConfigured ? undefined : "Configure Google Calendar in Settings > Connected Tools."
    },
    {
      key: "googleCalendarConnection",
      label: "Google Calendar connected account",
      status: googleConnected ? "healthy" : "warning",
      detail: googleConnected
        ? `Connected to ${googleConnection.accountName ?? "Google Calendar"}.`
        : googleConnection?.errorMessage ?? "Google Calendar has not completed OAuth connection yet. ICS fallback can still generate invite files.",
      nextAction: googleConnected ? "Create a diagnostic Google Calendar event from Settings > Connected Tools." : "Use Connected Tools > Google Calendar > Connect, or use ICS fallback for calendar invite generation."
    },
    {
      key: "jotformSecret",
      label: "Jotform webhook secret",
      status: presence.webhookSecretConfigured ? "healthy" : "warning",
      detail: presence.webhookSecretConfigured ? "Jotform webhook secret is present." : "Jotform intake requires WEBHOOK_SECRET.",
      nextAction: presence.webhookSecretConfigured ? undefined : "Generate or set WEBHOOK_SECRET before relying on production intake."
    },
    {
      key: "quickbooks",
      label: "QuickBooks",
      status: quickBooksSetup.configured || presence.quickBooksConfigured ? "healthy" : "warning",
      detail: quickBooksSetup.configured
        ? `QuickBooks ${quickBooksSetup.environment} setup is saved in the app.`
        : presence.quickBooksConfigured
          ? "QuickBooks credentials are present in the environment. Use Connected Tools to move setup into the app."
          : "QuickBooks sync requires client credentials and webhook verifier.",
      nextAction: quickBooksSetup.configured || presence.quickBooksConfigured ? undefined : "Configure QuickBooks in Settings > Connected Tools."
    },
    {
      key: "cron",
      label: "Scheduled jobs",
      status: presence.cronSecretConfigured ? "healthy" : "warning",
      detail: presence.cronSecretConfigured ? "CRON_SECRET is present for scheduled job routes." : "Automated jobs require CRON_SECRET.",
      nextAction: presence.cronSecretConfigured ? undefined : "Add CRON_SECRET and verify Vercel cron/job calls."
    }
  ];

  return checks.map((check) => ({
    ...check,
    nextAction: check.nextAction
  }));
}

function legacyIntegrationChecks(): HealthCheck[] {
  const presence = getEnvPresence();
  const checks: Array<[string, string, boolean, HealthStatus, string]> = [
    ["supabaseAuth", "Supabase Auth", presence.supabaseUrl && presence.supabaseAnonKey && presence.supabaseServiceRoleKey, "blocked", "Authentication requires Supabase URL, anon key, and service role key."]
  ];

  return checks.map(([key, label, ready, missingStatus, detail]) => ({
    key,
    label,
    status: ready ? "healthy" : missingStatus,
    detail: ready ? "Configuration is present." : detail,
    nextAction: ready ? undefined : "Add the missing environment variables in Vercel/Supabase production settings."
  }));
}

function group(key: string, title: string, summary: string, checks: HealthCheck[]): HealthGroup {
  return {
    key,
    title,
    summary,
    checks,
    status: worstStatus(checks.map((check) => check.status))
  };
}

export async function buildSystemHealth(): Promise<SystemHealth> {
  const database = await databaseCheck();
  const databaseReady = database.status === "healthy";
  const integrations = databaseReady ? await integrationChecks() : legacyIntegrationChecks();
  const groups = [
    group("database", "Database", "Connectivity and production migration readiness.", [
      database,
      ...await schemaChecks(databaseReady)
    ]),
    group("storage", "Storage", "Supabase buckets used by thumbnails, attachments, materials, invoices, and receipts.", await storageChecks()),
    group("integrations", "Integrations", "External systems needed for real operations.", integrations)
  ];

  return {
    status: worstStatus(groups.map((item) => item.status)),
    generatedAt: new Date().toISOString(),
    database: databaseReady,
    groups
  };
}
