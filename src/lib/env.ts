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
        env.GOOGLE_CALENDAR_REDIRECT_URI
    ),
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
