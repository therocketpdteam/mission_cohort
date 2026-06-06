import { PrismaClient } from "@prisma/client";

function migrationDatabaseUrl() {
  const value = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is required to apply production schema patches.");
  }

  if (process.env.DATABASE_DIRECT_URL) {
    return value;
  }

  const url = new URL(value);

  if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
    url.search = "";
    return url.toString();
  }

  return value;
}

function describeDatabase(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "configured database";
  }
}

const databaseUrl = migrationDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

const patches = [
  {
    name: "finance enums",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceDraftStatus') THEN
          CREATE TYPE "InvoiceDraftStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOIDED', 'CANCELLED');
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DistributionPayoutStatus') THEN
          CREATE TYPE "DistributionPayoutStatus" AS ENUM ('PLANNED', 'PARTIAL', 'PAID', 'CANCELLED');
        END IF;
      END $$;
    `
  },
  {
    name: "communication attachments",
    sql: `
      CREATE TABLE IF NOT EXISTS "CommunicationAttachment" (
        "id" TEXT NOT NULL,
        "communicationId" TEXT,
        "templateId" TEXT,
        "fileName" TEXT NOT NULL,
        "contentType" TEXT,
        "fileSize" INTEGER,
        "provider" TEXT NOT NULL DEFAULT 'supabase',
        "fileKey" TEXT NOT NULL,
        "url" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CommunicationAttachment_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "CommunicationAttachment_communicationId_idx" ON "CommunicationAttachment"("communicationId");
      CREATE INDEX IF NOT EXISTS "CommunicationAttachment_templateId_idx" ON "CommunicationAttachment"("templateId");
      CREATE INDEX IF NOT EXISTS "CommunicationAttachment_fileKey_idx" ON "CommunicationAttachment"("fileKey");
    `
  },
  {
    name: "invoice drafts",
    sql: `
      CREATE TABLE IF NOT EXISTS "InvoiceDraft" (
        "id" TEXT NOT NULL,
        "cohortId" TEXT NOT NULL,
        "registrationId" TEXT,
        "organizationId" TEXT,
        "invoiceNumber" TEXT,
        "purchaseOrderNumber" TEXT,
        "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "dueDate" TIMESTAMP(3),
        "status" "InvoiceDraftStatus" NOT NULL DEFAULT 'DRAFT',
        "subtotalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "pdfFileKey" TEXT,
        "pdfUrl" TEXT,
        "receiptFileKey" TEXT,
        "receiptUrl" TEXT,
        "quickBooksCustomerRef" TEXT,
        "quickBooksInvoiceRef" TEXT,
        "quickBooksRealmId" TEXT,
        "quickBooksInvoiceStatus" "QuickBooksInvoiceStatus" NOT NULL DEFAULT 'UNKNOWN',
        "quickBooksSyncStatus" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "InvoiceDraft_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "InvoiceLineItem" (
        "id" TEXT NOT NULL,
        "invoiceDraftId" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "unitAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "InvoiceDraft_cohortId_idx" ON "InvoiceDraft"("cohortId");
      CREATE INDEX IF NOT EXISTS "InvoiceDraft_registrationId_idx" ON "InvoiceDraft"("registrationId");
      CREATE INDEX IF NOT EXISTS "InvoiceDraft_organizationId_idx" ON "InvoiceDraft"("organizationId");
      CREATE INDEX IF NOT EXISTS "InvoiceDraft_status_idx" ON "InvoiceDraft"("status");
      CREATE INDEX IF NOT EXISTS "InvoiceDraft_invoiceNumber_idx" ON "InvoiceDraft"("invoiceNumber");
      CREATE INDEX IF NOT EXISTS "InvoiceLineItem_invoiceDraftId_idx" ON "InvoiceLineItem"("invoiceDraftId");
    `
  },
  {
    name: "distribution ledger",
    sql: `
      CREATE TABLE IF NOT EXISTS "CohortDistribution" (
        "id" TEXT NOT NULL,
        "cohortId" TEXT NOT NULL,
        "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
        "tlName" TEXT,
        "tlSharePercent" DECIMAL(5,2) NOT NULL DEFAULT 70,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "CohortDistribution_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "DistributionPayout" (
        "id" TEXT NOT NULL,
        "distributionId" TEXT NOT NULL,
        "paymentRecordId" TEXT,
        "amount" DECIMAL(10,2) NOT NULL,
        "status" "DistributionPayoutStatus" NOT NULL DEFAULT 'PLANNED',
        "paymentDate" TIMESTAMP(3),
        "attachmentFileKey" TEXT,
        "attachmentUrl" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "DistributionPayout_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "CohortDistribution_cohortId_key" ON "CohortDistribution"("cohortId");
      CREATE INDEX IF NOT EXISTS "DistributionPayout_distributionId_idx" ON "DistributionPayout"("distributionId");
      CREATE INDEX IF NOT EXISTS "DistributionPayout_paymentRecordId_idx" ON "DistributionPayout"("paymentRecordId");
      CREATE INDEX IF NOT EXISTS "DistributionPayout_status_idx" ON "DistributionPayout"("status");
    `
  },
  {
    name: "jotform revision metadata",
    sql: `
      ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "registrationId" TEXT;
      ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "externalSubmissionId" TEXT;
      ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "revisionNumber" INTEGER;
      ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "normalizedSummary" JSONB;

      CREATE INDEX IF NOT EXISTS "WebhookEvent_registrationId_idx" ON "WebhookEvent"("registrationId");
      CREATE INDEX IF NOT EXISTS "WebhookEvent_externalSubmissionId_idx" ON "WebhookEvent"("externalSubmissionId");
    `
  },
  {
    name: "email event issue review",
    sql: `
      ALTER TABLE "EmailEvent" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
      ALTER TABLE "EmailEvent" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
      ALTER TABLE "EmailEvent" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;

      CREATE INDEX IF NOT EXISTS "EmailEvent_reviewedAt_idx" ON "EmailEvent"("reviewedAt");
      CREATE INDEX IF NOT EXISTS "EmailEvent_reviewedById_idx" ON "EmailEvent"("reviewedById");
    `
  },
  {
    name: "foreign keys",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationAttachment_communicationId_fkey') THEN
          ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "CohortCommunication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationAttachment_templateId_fkey') THEN
          ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceDraft_cohortId_fkey') THEN
          ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceDraft_registrationId_fkey') THEN
          ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceDraft_organizationId_fkey') THEN
          ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceLineItem_invoiceDraftId_fkey') THEN
          ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceDraftId_fkey" FOREIGN KEY ("invoiceDraftId") REFERENCES "InvoiceDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CohortDistribution_cohortId_fkey') THEN
          ALTER TABLE "CohortDistribution" ADD CONSTRAINT "CohortDistribution_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DistributionPayout_distributionId_fkey') THEN
          ALTER TABLE "DistributionPayout" ADD CONSTRAINT "DistributionPayout_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "CohortDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DistributionPayout_paymentRecordId_fkey') THEN
          ALTER TABLE "DistributionPayout" ADD CONSTRAINT "DistributionPayout_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebhookEvent_registrationId_fkey') THEN
          ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailEvent_reviewedById_fkey') THEN
          ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `
  }
];

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inDollarBlock = false;

  for (let index = 0; index < sql.length; index += 1) {
    if (sql.startsWith("$$", index)) {
      inDollarBlock = !inDollarBlock;
      current += "$$";
      index += 1;
      continue;
    }

    const character = sql[index];

    if (character === ";" && !inDollarBlock) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

async function main() {
  console.log(`Applying production schema patches against ${describeDatabase(databaseUrl)}`);

  for (const patch of patches) {
    for (const statement of splitSqlStatements(patch.sql)) {
      await prisma.$executeRawUnsafe(statement);
    }
    console.log(`Schema patch ready: ${patch.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
