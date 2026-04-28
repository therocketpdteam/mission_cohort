import { env } from "@/lib/env";

export async function sendEmailPlaceholder() {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) {
    throw Object.assign(new Error("SendGrid integration is not configured"), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return { status: "not_implemented" as const };
}
