ALTER TABLE "Cohort" ADD COLUMN "quickBooksProjectRef" TEXT;
ALTER TABLE "Cohort" ADD COLUMN "quickBooksProjectName" TEXT;
ALTER TABLE "Cohort" ADD COLUMN "quickBooksParentCustomerRef" TEXT;
ALTER TABLE "Cohort" ADD COLUMN "quickBooksRealmId" TEXT;
ALTER TABLE "Cohort" ADD COLUMN "quickBooksSyncStatus" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED';
ALTER TABLE "Cohort" ADD COLUMN "quickBooksSyncError" TEXT;
ALTER TABLE "Cohort" ADD COLUMN "quickBooksLastSyncedAt" TIMESTAMP(3);

ALTER TABLE "InvoiceDraft" ADD COLUMN "quickBooksSyncError" TEXT;
ALTER TABLE "InvoiceDraft" ADD COLUMN "quickBooksLastSyncedAt" TIMESTAMP(3);

CREATE INDEX "Cohort_quickBooksProjectRef_idx" ON "Cohort"("quickBooksProjectRef");
CREATE INDEX "Cohort_quickBooksSyncStatus_idx" ON "Cohort"("quickBooksSyncStatus");
CREATE INDEX "InvoiceDraft_quickBooksInvoiceRef_idx" ON "InvoiceDraft"("quickBooksInvoiceRef");
CREATE INDEX "InvoiceDraft_quickBooksSyncStatus_idx" ON "InvoiceDraft"("quickBooksSyncStatus");
