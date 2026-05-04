import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredEnv = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_BASE_URL",
  "WEBHOOK_SECRET"
];

const optionalEnv = [
  "CRON_SECRET",
  "SENDGRID_API_KEY",
  "SENDGRID_FROM_EMAIL",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_ID",
  "QUICKBOOKS_CLIENT_ID",
  "QUICKBOOKS_CLIENT_SECRET",
  "QUICKBOOKS_REDIRECT_URI",
  "QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN",
  "CRM_WEBHOOK_URL",
  "CRM_WEBHOOK_SECRET",
  "MUX_TOKEN_ID",
  "MUX_TOKEN_SECRET"
];

function loadLocalEnv() {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function present(name) {
  return Boolean(process.env[name]?.trim());
}

async function probeJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function main() {
  loadLocalEnv();
  console.log("== Mission Control readiness ==");

  const missingRequired = requiredEnv.filter((name) => !present(name));
  console.log("\nRequired env:");
  for (const name of requiredEnv) {
    console.log(`- ${name}: ${present(name) ? "present" : "missing"}`);
  }

  console.log("\nOptional integration env:");
  for (const name of optionalEnv) {
    console.log(`- ${name}: ${present(name) ? "present" : "missing"}`);
  }

  if (missingRequired.length > 0) {
    console.log(`\nMissing required env for production readiness: ${missingRequired.join(", ")}`);
  }

  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");

  if (appBaseUrl) {
    console.log("\nEndpoint probes:");
    const health = await probeJson(`${appBaseUrl}/api/health`).catch((error) => ({
      status: 0,
      body: error instanceof Error ? error.message : "Unknown health probe error"
    }));
    console.log(`- /api/health: ${health.status}`);
    console.log(JSON.stringify(health.body, null, 2));

    const webhook = await fetch(`${appBaseUrl}/api/webhooks/registrations`, {
      method: "GET",
      cache: "no-store"
    }).catch(() => null);
    console.log(`- /api/webhooks/registrations GET: ${webhook?.status ?? "unreachable"} (405 is expected)`);
  } else {
    console.log("\nSet APP_BASE_URL to probe deployed endpoints.");
  }

  if (missingRequired.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
