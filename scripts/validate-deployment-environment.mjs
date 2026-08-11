const productionSupabaseRef = "upmmeahfxgynykubdxmi";
const productionAppHosts = new Set([
  "mission-cohort-six.vercel.app"
]);

function normalize(value) {
  return String(value ?? "").trim();
}

function appEnvironment() {
  const rawValue = normalize(process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || process.env.VERCEL_ENV || "local").toLowerCase();

  if (rawValue === "production" || rawValue === "prod") return "production";
  if (rawValue === "staging" || rawValue === "stage" || rawValue === "preview") return "staging";
  return "local";
}

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function hasProductionSupabaseRef(value) {
  return normalize(value).toLowerCase().includes(productionSupabaseRef);
}

function main() {
  const environment = appEnvironment();
  const appBaseHost = hostname(process.env.APP_BASE_URL);
  const failures = [];

  if (environment === "staging") {
    if (hasProductionSupabaseRef(process.env.DATABASE_URL) || hasProductionSupabaseRef(process.env.DATABASE_DIRECT_URL)) {
      failures.push("Staging DATABASE_URL/DATABASE_DIRECT_URL points at the known production Supabase project.");
    }

    if (hasProductionSupabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      failures.push("Staging NEXT_PUBLIC_SUPABASE_URL points at the known production Supabase project.");
    }

    if (productionAppHosts.has(appBaseHost)) {
      failures.push("Staging APP_BASE_URL points at the production app host.");
    }

    if (normalize(process.env.ALLOW_BACKGROUND_JOBS).toLowerCase() === "true") {
      failures.push("Staging ALLOW_BACKGROUND_JOBS must stay false unless using isolated test integrations.");
    }
  }

  if (environment === "production" && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    failures.push(`APP_ENV=production cannot be deployed with VERCEL_ENV=${process.env.VERCEL_ENV}.`);
  }

  if (failures.length > 0) {
    console.error("Deployment environment validation failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Deployment environment validated: ${environment}`);
}

main();
