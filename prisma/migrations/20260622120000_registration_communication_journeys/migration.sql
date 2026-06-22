ALTER TYPE "CommunicationStatus" ADD VALUE IF NOT EXISTS 'SKIPPED' BEFORE 'SENDING';

ALTER TABLE "CohortCommunication"
  ADD COLUMN IF NOT EXISTS "registrationId" TEXT,
  ADD COLUMN IF NOT EXISTS "participantId" TEXT,
  ADD COLUMN IF NOT EXISTS "journeyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CohortCommunication_journeyKey_key" ON "CohortCommunication"("journeyKey");
CREATE INDEX IF NOT EXISTS "CohortCommunication_registrationId_idx" ON "CohortCommunication"("registrationId");
CREATE INDEX IF NOT EXISTS "CohortCommunication_participantId_idx" ON "CohortCommunication"("participantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CohortCommunication_registrationId_fkey') THEN
    ALTER TABLE "CohortCommunication" ADD CONSTRAINT "CohortCommunication_registrationId_fkey"
      FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CohortCommunication_participantId_fkey') THEN
    ALTER TABLE "CohortCommunication" ADD CONSTRAINT "CohortCommunication_participantId_fkey"
      FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
