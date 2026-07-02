CREATE TABLE "HistoricalImportBatch" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mappingJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "importedCohorts" INTEGER NOT NULL DEFAULT 0,
  "importedRegistrations" INTEGER NOT NULL DEFAULT 0,
  "importedParticipants" INTEGER NOT NULL DEFAULT 0,
  "importedPayments" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HistoricalImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HistoricalImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rawRowJson" JSONB NOT NULL,
  "normalizedJson" JSONB,
  "warningsJson" JSONB,
  "errorsJson" JSONB,
  "importedEntityIdsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HistoricalImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HistoricalImportBatch_status_idx" ON "HistoricalImportBatch"("status");
CREATE INDEX "HistoricalImportBatch_createdById_idx" ON "HistoricalImportBatch"("createdById");
CREATE INDEX "HistoricalImportBatch_startedAt_idx" ON "HistoricalImportBatch"("startedAt");
CREATE INDEX "HistoricalImportRow_batchId_idx" ON "HistoricalImportRow"("batchId");
CREATE INDEX "HistoricalImportRow_rowNumber_idx" ON "HistoricalImportRow"("rowNumber");

ALTER TABLE "HistoricalImportBatch"
  ADD CONSTRAINT "HistoricalImportBatch_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HistoricalImportRow"
  ADD CONSTRAINT "HistoricalImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "HistoricalImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
