ALTER TABLE "EmailEvent"
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "EmailEvent_reviewedAt_idx" ON "EmailEvent"("reviewedAt");
CREATE INDEX "EmailEvent_reviewedById_idx" ON "EmailEvent"("reviewedById");

ALTER TABLE "EmailEvent"
  ADD CONSTRAINT "EmailEvent_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
