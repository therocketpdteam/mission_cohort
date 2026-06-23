ALTER TABLE "Registration"
  ADD COLUMN IF NOT EXISTS "pendingChanges" JSONB,
  ADD COLUMN IF NOT EXISTS "pendingChangesAt" TIMESTAMP(3);
