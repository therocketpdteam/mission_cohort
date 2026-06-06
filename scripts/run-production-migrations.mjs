import { spawn } from "node:child_process";

const migrationTimeoutMs = Number(process.env.PRISMA_MIGRATE_TIMEOUT_MS || 180000);

function migrationDatabaseUrl() {
  const value = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is required to run production migrations.");
  }

  if (process.env.DATABASE_DIRECT_URL) {
    return value;
  }

  const url = new URL(value);

  if (url.hostname.includes("pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
    url.search = "";
    return url.toString();
  }

  return value;
}

function describeDatabase(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "configured database";
  }
}

async function run() {
  const databaseUrl = migrationDatabaseUrl();
  const child = spawn("pnpm", ["prisma", "migrate", "deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK || "1"
    },
    stdio: "inherit"
  });
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, migrationTimeoutMs);

  console.log(`Running Prisma migrations against ${describeDatabase(databaseUrl)}`);

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  clearTimeout(timer);

  if (exitCode !== 0) {
    throw new Error(`Prisma migrate deploy failed or timed out after ${Math.round(migrationTimeoutMs / 1000)} seconds.`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
