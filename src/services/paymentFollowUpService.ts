import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PAYMENT_STATUS_FOLLOW_UP_TITLE } from "@/lib/paymentFollowUps";

// Only the standard intake task is resolved. Refund/QuickBooks/custom review
// work remains open. Use the same settlement definition as cohort finance:
// the paid flag, or receipts/invoices covering a positive registration total.
export async function reconcilePaidPaymentFollowUps(
  scope: { registrationId?: string; registrationIds?: string[]; cohortId?: string } = {},
  client: Pick<Prisma.TransactionClient, "$executeRaw"> = prisma
) {
  if (scope.registrationIds?.length === 0) return { count: 0 };
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE "OperationsTask" t
    SET "status" = 'COMPLETED', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    FROM "Registration" r
    WHERE t."registrationId" = r."id"
      AND t."category" = 'PAYMENT_FOLLOW_UP'
      AND t."title" = ${PAYMENT_STATUS_FOLLOW_UP_TITLE}
      AND t."status" IN ('OPEN', 'IN_PROGRESS')
      ${scope.registrationId ? Prisma.sql`AND t."registrationId" = ${scope.registrationId}` : Prisma.empty}
      ${scope.registrationIds ? Prisma.sql`AND t."registrationId" IN (${Prisma.join(scope.registrationIds)})` : Prisma.empty}
      ${scope.cohortId ? Prisma.sql`AND t."cohortId" = ${scope.cohortId}` : Prisma.empty}
      AND (
        r."paymentStatus" = 'PAID'
        OR (
          r."paymentStatus" NOT IN ('REFUNDED', 'CANCELLED') AND r."paymentMethod" <> 'COMPED' AND r."totalAmount" > 0
          AND GREATEST(
            COALESCE((SELECT SUM(p."amount") FROM "PaymentRecord" p WHERE p."registrationId" = r."id" AND p."status" IN ('PAID', 'PARTIALLY_PAID')), 0),
            COALESCE((SELECT SUM(i."paidAmount") FROM "InvoiceDraft" i WHERE i."registrationId" = r."id" AND i."status" NOT IN ('VOIDED', 'CANCELLED')), 0)
          ) >= r."totalAmount"
        )
      )
  `);
  return { count };
}
