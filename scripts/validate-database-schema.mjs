import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const requiredColumns = [
  ["Registration", "purchaseOrderFileKey"],
  ["Registration", "purchaseOrderFileName"],
  ["Registration", "checkPaymentFileKey"],
  ["Registration", "checkPaymentFileName"],
  ["Registration", "checkPaymentContentType"]
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the schema compatibility check.");
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const columns = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((column) => !columns.has(column));
  const paymentMethods = await prisma.$queryRawUnsafe(`
    SELECT enumlabel
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'PaymentMethod'
  `);

  if (!paymentMethods.some((row) => row.enumlabel === "CHECK")) {
    missing.push("PaymentMethod.CHECK");
  }

  if (missing.length > 0) {
    throw new Error(`Database schema is behind this release. Apply schema patches first. Missing: ${missing.join(", ")}`);
  }

  console.log("Database schema compatibility validated.");
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
