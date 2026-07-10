import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_WEBHOOK_URL = "https://rocketpd-sales-os-git-staging-rocket-pd.vercel.app/api/webhooks/mission-cohort/registrations";

function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    return false;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }

  return true;
}

function loadEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local"),
    process.env.CRM_STAGING_ENV_FILE ? resolve(process.env.CRM_STAGING_ENV_FILE) : "",
    resolve(process.cwd(), ".env.mission-cohort.staging.local"),
    resolve(process.cwd(), "../rocketpd-sales-os/.env.mission-cohort.staging.local"),
    resolve(process.cwd(), "../rocketpd-sales-os-git-staging-rocket-pd/.env.mission-cohort.staging.local"),
    resolve(process.cwd(), "../../rocketpd-sales-os/.env.mission-cohort.staging.local")
  ].filter(Boolean);

  const loaded = candidates.filter(loadEnvFile);

  if (!process.env.CRM_MISSION_COHORT_WEBHOOK_URL && !process.env.CRM_REGISTRATION_WEBHOOK_URL) {
    process.env.CRM_MISSION_COHORT_WEBHOOK_URL = STAGING_WEBHOOK_URL;
  }

  if (!process.env.CRM_MISSION_COHORT_WEBHOOK_SECRET && !process.env.CRM_REGISTRATION_WEBHOOK_SECRET && process.env.MISSION_COHORT_WEBHOOK_SECRET) {
    process.env.CRM_MISSION_COHORT_WEBHOOK_SECRET = process.env.MISSION_COHORT_WEBHOOK_SECRET;
  }

  return loaded;
}

async function main() {
  const loadedEnvFiles = loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const registrationId = args.find((arg) => !arg.startsWith("--"));

  if (!registrationId) {
    console.log("Usage: pnpm crm:sync-registration <registrationId> [--dry-run]");
    console.log("Set CRM_STAGING_ENV_FILE=/path/to/.env.mission-cohort.staging.local if the CRM env file is not in a default sibling repo path.");
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("../src/lib/prisma");
  const { buildCrmRegistrationWebhookPayload, syncRegistrationToCrmWebhook } = await import("../src/services/crmRegistrationWebhookService");

  try {
    if (dryRun) {
      const registration = await prisma.registration.findUnique({
        where: { id: registrationId },
        include: {
          cohort: { include: { presenter: true } },
          organization: true,
          participants: true
        }
      });

      if (!registration) {
        throw new Error(`Registration ${registrationId} was not found.`);
      }

      console.log(JSON.stringify(buildCrmRegistrationWebhookPayload(registration), null, 2));
      return;
    }

    console.log(`Loaded env files: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "none"}`);
    console.log(`Posting registration ${registrationId} to CRM registration webhook staging...`);
    const result = await syncRegistrationToCrmWebhook(registrationId, "manual.registration_sync");

    if (result.status !== "sent") {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
