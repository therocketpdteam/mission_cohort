import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

const sandboxBaseUrl = "https://sandbox-quickbooks.api.intuit.com";
const productionBaseUrl = "https://quickbooks.api.intuit.com";

function getQuickBooksBaseUrl() {
  return env.QUICKBOOKS_ENVIRONMENT === "production" ? productionBaseUrl : sandboxBaseUrl;
}

export function getQuickBooksConnectUrl(state = "mission-control") {
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_REDIRECT_URI) {
    throw Object.assign(new Error("QuickBooks OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id", env.QUICKBOOKS_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.QUICKBOOKS_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeQuickBooksCode(code: string) {
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET || !env.QUICKBOOKS_REDIRECT_URI) {
    throw Object.assign(new Error("QuickBooks OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const basic = Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.QUICKBOOKS_REDIRECT_URI
    })
  });

  if (!response.ok) {
    throw Object.assign(new Error(`QuickBooks token exchange failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    x_refresh_token_expires_in?: number;
  }>;
}

export function verifyQuickBooksWebhookSignature(rawBody: string, signature?: string | null) {
  if (!env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const digest = createHmac("sha256", env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN)
    .update(rawBody)
    .digest("base64");

  return digest === signature;
}

export async function fetchQuickBooksInvoice(input: {
  realmId: string;
  accessToken: string;
  invoiceId: string;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl()}/v3/company/${input.realmId}/invoice/${input.invoiceId}?minorversion=75`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw Object.assign(new Error(`QuickBooks invoice fetch failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<Record<string, any>>;
}

export async function voidQuickBooksInvoice(input: {
  realmId: string;
  accessToken: string;
  invoice: Record<string, any>;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl()}/v3/company/${input.realmId}/invoice?operation=void&minorversion=75`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ Invoice: input.invoice })
  });

  if (!response.ok) {
    throw Object.assign(new Error(`QuickBooks invoice void failed with status ${response.status}`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  return response.json() as Promise<Record<string, any>>;
}
