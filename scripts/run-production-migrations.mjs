import { spawn } from "node:child_process";

const migrationTimeoutMs = Number(process.env.PRISMA_MIGRATE_TIMEOUT_MS || 180000);

function directSupabaseUrl(value) {
  if (!value) {
    throw new Error("DATABASE_URL is required to run production migrations.");
  }

  const url = new URL(value);
  const username = decodeURIComponent(url.username);

  if (!url.hostname.includes("pooler.supabase.com")) {
    return value;
  }

  const projectRef = username.startsWith("postgres.") ? username.slice("postgres.".length) : "";

  if (!projectRef) {
    throw new Error("Could not derive Supabase project ref from pooled DATABASE_URL username.");
  }

  url.hostname = `db.${projectRef}.supabase.co`;
  url.port = "5432";
  url.username = "postgres";
  url.search = "";

  return url.toString();
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
  const databaseUrl = directSupabaseUrl(process.env.DATABASE_URL);
  const child = spawn("pnpm", ["prisma", "migrate", "deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
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
