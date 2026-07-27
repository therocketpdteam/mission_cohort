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
    apiKey: normalizeSendGridApiKey(decryptSecret(connection?.accessToken) ?? env.SENDGRID_API_KEY),
    fromEmail: String(metadata.fromEmail ?? env.SENDGRID_FROM_EMAIL ?? ""),
    fromName: String(metadata.fromName ?? connection?.accountName ?? "")
  };
}

export function normalizeSendGridApiKey(value?: string | null) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  return cleaned || undefined;
}

async function sendGridErrorMessage(response: Response) {
  const fallback = `SendGrid request failed with status ${response.status}`;
  const text = await response.text().catch(() => "");

  if (!text) {
    return response.status === 401
      ? "SendGrid rejected the saved API key with status 401. Save a valid SendGrid API key with Mail Send access."
      : fallback;
  }

  try {
    const payload = JSON.parse(text) as { errors?: Array<{ message?: string; field?: string; help?: string }> };
    const details = (payload.errors ?? [])
      .map((error) => [error.message, error.field ? `field: ${error.field}` : "", error.help].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" ");

    if (details) {
      return response.status === 401
        ? `SendGrid rejected the saved API key with status 401. ${details}`
        : `SendGrid request failed with status ${response.status}. ${details}`;
    }
  } catch {
    // Fall through to the concise provider status message.
  }

  return response.status === 401
    ? "SendGrid rejected the saved API key with status 401. Save a valid SendGrid API key with Mail Send access."
    : fallback;
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
    throw Object.assign(new Error(await sendGridErrorMessage(response)), {
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
