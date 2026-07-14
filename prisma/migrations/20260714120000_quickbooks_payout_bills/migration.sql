ALTER TABLE "CohortDistribution"
  ADD COLUMN "quickBooksVendorRef" TEXT,
  ADD COLUMN "quickBooksExpenseAccountRef" TEXT;

ALTER TABLE "DistributionPayout"
  ADD COLUMN "quickBooksBillRef" TEXT,
  ADD COLUMN "quickBooksBillNumber" TEXT,
  ADD COLUMN "quickBooksRealmId" TEXT,
  ADD COLUMN "quickBooksSyncStatus" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
  ADD COLUMN "quickBooksSyncError" TEXT,
  ADD COLUMN "quickBooksLastSyncedAt" TIMESTAMP(3);

CREATE INDEX "DistributionPayout_quickBooksBillRef_idx" ON "DistributionPayout"("quickBooksBillRef");
CREATE INDEX "DistributionPayout_quickBooksSyncStatus_idx" ON "DistributionPayout"("quickBooksSyncStatus");
