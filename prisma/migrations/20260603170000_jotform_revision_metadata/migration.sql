-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "registrationId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "externalSubmissionId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "revisionNumber" INTEGER;
ALTER TABLE "WebhookEvent" ADD COLUMN "normalizedSummary" JSONB;

-- CreateIndex
CREATE INDEX "WebhookEvent_registrationId_idx" ON "WebhookEvent"("registrationId");

-- CreateIndex
CREATE INDEX "WebhookEvent_externalSubmissionId_idx" ON "WebhookEvent"("externalSubmissionId");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
