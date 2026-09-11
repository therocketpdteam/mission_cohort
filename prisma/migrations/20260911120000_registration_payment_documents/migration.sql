ALTER TABLE "Registration"
  ADD COLUMN IF NOT EXISTS "purchaseOrderFileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "purchaseOrderFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "checkPaymentFileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "checkPaymentFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "checkPaymentContentType" TEXT;
