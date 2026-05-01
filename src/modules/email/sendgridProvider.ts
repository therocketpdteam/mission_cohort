import { env } from "@/lib/env";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
};

export async function sendWithSendGrid(input: SendEmailInput) {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) {
    throw Object.assign(new Error("SendGrid is not configured. Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: input.from ?? env.SENDGRID_FROM_EMAIL },
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
