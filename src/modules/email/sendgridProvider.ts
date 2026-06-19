import { env } from "@/lib/env";
import { decryptSecret } from "@/lib/integrationCrypto";
import { prisma } from "@/lib/prisma";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
};

async function getSendGridConfig() {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider_label: { provider: "SENDGRID", label: "default" } },
    select: { accessToken: true, accountName: true, metadata: true }
  }).catch(() => null);
  const metadata = (connection?.metadata && typeof connection.metadata === "object" ? connection.metadata : {}) as Record<string, unknown>;

  return {
    apiKey: decryptSecret(connection?.accessToken) ?? env.SENDGRID_API_KEY,
    fromEmail: String(metadata.fromEmail ?? env.SENDGRID_FROM_EMAIL ?? ""),
    fromName: String(metadata.fromName ?? connection?.accountName ?? "")
  };
}

export async function sendWithSendGrid(input: SendEmailInput) {
  const config = await getSendGridConfig();

  if (!config.apiKey || !config.fromEmail) {
    throw Object.assign(new Error("SendGrid is not configured. Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: input.from ?? config.fromEmail, ...(config.fromName ? { name: config.fromName } : {}) },
      subject: input.subject,
      content: [
        { type: "text/plain", value: input.text ?? input.html.replace(/<[^>]+>/g, " ") },
        { type: "text/html", value: input.html }
      ]
    })
  });

  if (!response.ok) {
    throw Object.assign(new Error(`SendGrid request failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return {
    provider: "sendgrid",
    accepted: recipients,
    providerMessageId: response.headers.get("x-message-id") ?? undefined
  };
}
