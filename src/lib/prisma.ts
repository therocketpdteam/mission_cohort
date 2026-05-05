import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(databaseUrl);

    if (url.hostname.includes("pooler.supabase.com")) {
      url.searchParams.set("sslmode", url.searchParams.get("sslmode") ?? "require");

      if (url.port === "6543") {
        url.searchParams.set("pgbouncer", "true");
        url.searchParams.set("connection_limit", url.searchParams.get("connection_limit") ?? "1");
      }
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const prismaDatabaseUrl = getPrismaDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: prismaDatabaseUrl,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
