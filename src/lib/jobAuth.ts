import { env } from "@/lib/env";

export function validateJobSecret(request: Request) {
  if (!env.CRON_SECRET) {
    return true;
  }

  const configuredSecret = env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = new URL(request.url).searchParams.get("secret");

  return headerSecret === configuredSecret || bearerSecret === configuredSecret || querySecret === configuredSecret;
}
