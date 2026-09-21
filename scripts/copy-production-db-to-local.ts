import { createReadStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const localContainer = process.env.LOCAL_DB_CONTAINER ?? "mission-cohort-local-db";
const localUser = process.env.LOCAL_DB_USER ?? "mission_cohort";
const localDatabase = process.env.LOCAL_DB_NAME ?? "mission_cohort";
const productionUrl = process.env.PRODUCTION_DATABASE_URL ?? process.env.PROD_DATABASE_URL;
const confirm = process.env.CONFIRM_PROD_TO_LOCAL_SYNC;

function run(command: string, args: string[], options: { env?: Record<string, string>; stdinFile?: string } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [options.stdinFile ? "pipe" : "ignore", "inherit", "inherit"],
      env: options.env ? { ...process.env, ...options.env } : process.env
    });

    if (options.stdinFile && child.stdin) {
      createReadStream(options.stdinFile).pipe(child.stdin);
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function requireProductionUrl(value?: string) {
  if (!value) {
    throw new Error("Set PRODUCTION_DATABASE_URL before running this script.");
  }

  const url = new URL(value);
  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host.includes("untuqynkgemgvwmnknhg")) {
    throw new Error("PRODUCTION_DATABASE_URL does not look like production. Refusing to copy.");
  }

  for (const unsupportedParam of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) {
    url.searchParams.delete(unsupportedParam);
  }

  return url.toString();
}

async function main() {
  if (confirm !== "copy-prod-to-local") {
    throw new Error("Set CONFIRM_PROD_TO_LOCAL_SYNC=copy-prod-to-local to replace the local Docker database with production data.");
  }

  const source = requireProductionUrl(productionUrl);
  const backupDir = join(process.cwd(), ".local-db-backups");
  const dumpPath = join(backupDir, `production-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  mkdirSync(backupDir, { recursive: true });

  console.log("Checking local Docker database container...");
  await run("docker", ["exec", localContainer, "pg_isready", "-U", localUser, "-d", localDatabase]);

  console.log("Creating production database dump into .local-db-backups/...");
  await run("docker", [
    "run",
    "--rm",
    "-e",
    "PGSOURCE",
    "--mount",
    `type=bind,src=${backupDir},dst=/backup`,
    "postgres:16-alpine",
    "sh",
    "-lc",
    `pg_dump --no-owner --no-acl --format=custom "$PGSOURCE" -f "/backup/${dumpPath.split("/").pop()}"`
  ], { env: { PGSOURCE: source } });

  console.log("Replacing local Docker database schema...");
  await run("docker", [
    "exec",
    localContainer,
    "psql",
    "-U",
    localUser,
    "-d",
    localDatabase,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  ]);

  console.log("Restoring production dump into local Docker database...");
  await run("docker", [
    "exec",
    "-i",
    localContainer,
    "pg_restore",
    "--no-owner",
    "--no-acl",
    "-U",
    localUser,
    "-d",
    localDatabase
  ], { stdinFile: dumpPath });

  console.log(`Done. Local Docker database now contains production data. Dump saved at ${dumpPath}`);
  console.log("Keep local dev running with OUTBOUND_RELEASE_LOCK=locked and ALLOW_BACKGROUND_JOBS=false.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
