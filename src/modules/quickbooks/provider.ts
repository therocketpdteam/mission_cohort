import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

const sandboxBaseUrl = "https://sandbox-quickbooks.api.intuit.com";
const productionBaseUrl = "https://quickbooks.api.intuit.com";

export type QuickBooksOAuthConfig = {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  webhookVerifierToken?: string | null;
  environment?: string | null;
};

function quickBooksConfig(config?: QuickBooksOAuthConfig) {
  return {
    clientId: config?.clientId ?? env.QUICKBOOKS_CLIENT_ID,
    clientSecret: config?.clientSecret ?? env.QUICKBOOKS_CLIENT_SECRET,
    redirectUri: config?.redirectUri ?? env.QUICKBOOKS_REDIRECT_URI,
    webhookVerifierToken: config?.webhookVerifierToken ?? env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN,
    environment: config?.environment ?? env.QUICKBOOKS_ENVIRONMENT
  };
}

function getQuickBooksBaseUrl(environment?: string | null) {
  return environment === "production" ? productionBaseUrl : sandboxBaseUrl;
}

export function getQuickBooksConnectUrl(state = "mission-control", config?: QuickBooksOAuthConfig) {
  const resolved = quickBooksConfig(config);

  if (!resolved.clientId || !resolved.redirectUri) {
    throw Object.assign(new Error("QuickBooks OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id", resolved.clientId);
  url.searchParams.set("redirect_uri", resolved.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeQuickBooksCode(code: string, config?: QuickBooksOAuthConfig) {
  const resolved = quickBooksConfig(config);

  if (!resolved.clientId || !resolved.clientSecret || !resolved.redirectUri) {
    throw Object.assign(new Error("QuickBooks OAuth is not configured."), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  const basic = Buffer.from(`${resolved.clientId}:${resolved.clientSecret}`).toString("base64");
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
      redirect_uri: resolved.redirectUri
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

export function verifyQuickBooksWebhookSignature(rawBody: string, signature?: string | null, config?: QuickBooksOAuthConfig) {
  const verifier = quickBooksConfig(config).webhookVerifierToken;

  if (!verifier) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const digest = createHmac("sha256", verifier)
    .update(rawBody)
    .digest("base64");

  return digest === signature;
}

export async function fetchQuickBooksInvoice(input: {
  realmId: string;
  accessToken: string;
  invoiceId: string;
  environment?: string | null;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/invoice/${input.invoiceId}?minorversion=75`, {
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
  environment?: string | null;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/invoice?operation=void&minorversion=75`, {
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
