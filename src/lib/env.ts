import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  DATABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SENDGRID_API_KEY: optionalString,
  SENDGRID_FROM_EMAIL: optionalString,
  GOOGLE_CALENDAR_CLIENT_ID: optionalString,
  GOOGLE_CALENDAR_CLIENT_SECRET: optionalString,
  GOOGLE_CALENDAR_REDIRECT_URI: optionalString,
  GOOGLE_CALENDAR_ID: optionalString,
  QUICKBOOKS_CLIENT_ID: optionalString,
  QUICKBOOKS_CLIENT_SECRET: optionalString,
  QUICKBOOKS_REDIRECT_URI: optionalString,
  QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: optionalString,
  QUICKBOOKS_ENVIRONMENT: optionalString,
  SENDGRID_WEBHOOK_PUBLIC_KEY: optionalString,
  CRM_WEBHOOK_URL: optionalString,
  CRM_WEBHOOK_SECRET: optionalString,
  MUX_TOKEN_ID: optionalString,
  MUX_TOKEN_SECRET: optionalString,
  MUX_WEBHOOK_SECRET: optionalString,
  INTEGRATION_ENCRYPTION_KEY: optionalString,
  WEBHOOK_SECRET: optionalString,
  APP_BASE_URL: optionalString
});

export const env = envSchema.parse(process.env);

export type EnvPresence = ReturnType<typeof getEnvPresence>;

export function getEnvPresence() {
  return {
    databaseUrl: Boolean(env.DATABASE_URL),
    supabaseUrl: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    sendgridConfigured: Boolean(env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL),
    googleCalendarConfigured: Boolean(
      env.GOOGLE_CALENDAR_CLIENT_ID &&
        env.GOOGLE_CALENDAR_CLIENT_SECRET &&
        env.GOOGLE_CALENDAR_REDIRECT_URI &&
        env.GOOGLE_CALENDAR_ID
    ),
    quickBooksConfigured: Boolean(
      env.QUICKBOOKS_CLIENT_ID &&
        env.QUICKBOOKS_CLIENT_SECRET &&
        env.QUICKBOOKS_REDIRECT_URI &&
        env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
    ),
    sendgridWebhookConfigured: Boolean(env.SENDGRID_WEBHOOK_PUBLIC_KEY),
    crmConfigured: Boolean(env.CRM_WEBHOOK_URL && env.CRM_WEBHOOK_SECRET),
    muxConfigured: Boolean(env.MUX_TOKEN_ID && env.MUX_TOKEN_SECRET),
    webhookSecretConfigured: Boolean(env.WEBHOOK_SECRET),
    appBaseUrlConfigured: Boolean(env.APP_BASE_URL)
  };
}

export function requireRequiredEnv() {
  const presence = getEnvPresence();
  const required: Array<[string, boolean]> = [
    ["DATABASE_URL", presence.databaseUrl],
    ["NEXT_PUBLIC_SUPABASE_URL", presence.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", presence.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", presence.supabaseServiceRoleKey]
  ];

  const missing = required
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return env;
}
