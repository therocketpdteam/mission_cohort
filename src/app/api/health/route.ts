import { ok } from "@/lib/api";
import { getEnvPresence } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let database = false;
  let schema = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('Registration', 'purchaseOrderFileKey'),
          ('Registration', 'purchaseOrderFileName'),
          ('Registration', 'checkPaymentFileKey'),
          ('Registration', 'checkPaymentFileName'),
          ('Registration', 'checkPaymentContentType')
        )
    `;
    schema = Number(rows[0]?.count ?? 0) === 5;
  } catch (error) {
    console.error("Health check database probe failed", error);
  }

  const env = getEnvPresence();

  return ok({
    database,
    schema,
    env
  }, { status: database && schema ? 200 : 503 });
}
