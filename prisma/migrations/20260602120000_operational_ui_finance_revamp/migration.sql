-- CreateEnum
CREATE TYPE "InvoiceDraftStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DistributionPayoutStatus" AS ENUM ('PLANNED', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "CommunicationAttachment" (
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

-- CreateTable
CREATE TABLE "InvoiceDraft" (
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

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
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

-- CreateTable
CREATE TABLE "CohortDistribution" (
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

-- CreateTable
CREATE TABLE "DistributionPayout" (
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

-- CreateIndex
CREATE INDEX "CommunicationAttachment_communicationId_idx" ON "CommunicationAttachment"("communicationId");

-- CreateIndex
CREATE INDEX "CommunicationAttachment_templateId_idx" ON "CommunicationAttachment"("templateId");

-- CreateIndex
CREATE INDEX "CommunicationAttachment_fileKey_idx" ON "CommunicationAttachment"("fileKey");

-- CreateIndex
CREATE INDEX "InvoiceDraft_cohortId_idx" ON "InvoiceDraft"("cohortId");

-- CreateIndex
CREATE INDEX "InvoiceDraft_registrationId_idx" ON "InvoiceDraft"("registrationId");

-- CreateIndex
CREATE INDEX "InvoiceDraft_organizationId_idx" ON "InvoiceDraft"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceDraft_status_idx" ON "InvoiceDraft"("status");

-- CreateIndex
CREATE INDEX "InvoiceDraft_invoiceNumber_idx" ON "InvoiceDraft"("invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceDraftId_idx" ON "InvoiceLineItem"("invoiceDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortDistribution_cohortId_key" ON "CohortDistribution"("cohortId");

-- CreateIndex
CREATE INDEX "DistributionPayout_distributionId_idx" ON "DistributionPayout"("distributionId");

-- CreateIndex
CREATE INDEX "DistributionPayout_paymentRecordId_idx" ON "DistributionPayout"("paymentRecordId");

-- CreateIndex
CREATE INDEX "DistributionPayout_status_idx" ON "DistributionPayout"("status");

-- AddForeignKey
ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "CohortCommunication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceDraftId_fkey" FOREIGN KEY ("invoiceDraftId") REFERENCES "InvoiceDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortDistribution" ADD CONSTRAINT "CohortDistribution_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionPayout" ADD CONSTRAINT "DistributionPayout_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "CohortDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionPayout" ADD CONSTRAINT "DistributionPayout_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
