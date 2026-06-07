ALTER TABLE "Registration" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Registration" ADD COLUMN "archivedReason" TEXT;

CREATE INDEX "Registration_archivedAt_idx" ON "Registration"("archivedAt");
