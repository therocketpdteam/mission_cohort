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

async function quickBooksError(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  let detail = body.trim();

  try {
    const parsed = JSON.parse(body) as Record<string, any>;
    const faults = parsed.Fault?.Error;
    if (Array.isArray(faults) && faults.length > 0) {
      detail = faults
        .map((fault) => [fault.Message, fault.Detail].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    // Keep raw text if QuickBooks does not return JSON.
  }

  return Object.assign(new Error(`${fallback} with status ${response.status}${detail ? `: ${detail}` : ""}`), {
    code: "BAD_REQUEST",
    status: 400
  });
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
    throw await quickBooksError(response, "QuickBooks token exchange failed");
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    x_refresh_token_expires_in?: number;
  }>;
}

export async function refreshQuickBooksToken(refreshToken: string, config?: QuickBooksOAuthConfig) {
  const resolved = quickBooksConfig(config);

  if (!resolved.clientId || !resolved.clientSecret) {
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
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw await quickBooksError(response, "QuickBooks token refresh failed");
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
    throw await quickBooksError(response, "QuickBooks invoice fetch failed");
  }

  return response.json() as Promise<Record<string, any>>;
}

export async function fetchQuickBooksCustomer(input: {
  realmId: string;
  accessToken: string;
  customerId: string;
  environment?: string | null;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/customer/${input.customerId}?minorversion=75`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw await quickBooksError(response, "QuickBooks customer fetch failed");
  }

  return response.json() as Promise<Record<string, any>>;
}

function escapeQuickBooksQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function queryQuickBooks(input: {
  realmId: string;
  accessToken: string;
  query: string;
  environment?: string | null;
}) {
  const url = new URL(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/query`);
  url.searchParams.set("query", input.query);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw await quickBooksError(response, "QuickBooks query failed");
  }

  return response.json() as Promise<Record<string, any>>;
}

export async function findQuickBooksProject(input: {
  realmId: string;
  accessToken: string;
  parentCustomerRef: string;
  projectName: string;
  environment?: string | null;
}) {
  const normalizedProjectName = input.projectName.trim().toLowerCase();
  const normalizedParentRef = input.parentCustomerRef.trim();
  const result = await queryQuickBooks({
    realmId: input.realmId,
    accessToken: input.accessToken,
    environment: input.environment,
    query: "select * from Customer startposition 1 maxresults 1000"
  });

  return ((result.QueryResponse?.Customer ?? []) as Record<string, any>[]).find((customer) => (
    String(customer.DisplayName ?? "").trim().toLowerCase() === normalizedProjectName &&
    String(customer.ParentRef?.value ?? "").trim() === normalizedParentRef &&
    customer.Job === true
  ));
}

export async function createQuickBooksProject(input: {
  realmId: string;
  accessToken: string;
  parentCustomerRef: string;
  projectName: string;
  environment?: string | null;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/customer?minorversion=75`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      DisplayName: input.projectName,
      Job: true,
      Active: true,
      ParentRef: {
        value: input.parentCustomerRef
      }
    })
  });

  if (!response.ok) {
    throw await quickBooksError(response, "QuickBooks project creation failed");
  }

  const result = await response.json() as Record<string, any>;
  return result.Customer ?? result;
}

export async function findQuickBooksInvoiceByDocNumber(input: {
  realmId: string;
  accessToken: string;
  docNumber: string;
  environment?: string | null;
}) {
  const escapedDocNumber = escapeQuickBooksQueryValue(input.docNumber);
  const result = await queryQuickBooks({
    realmId: input.realmId,
    accessToken: input.accessToken,
    environment: input.environment,
    query: `select * from Invoice where DocNumber = '${escapedDocNumber}'`
  });

  return (result.QueryResponse?.Invoice ?? [])[0] as Record<string, any> | undefined;
}

export async function createQuickBooksInvoice(input: {
  realmId: string;
  accessToken: string;
  invoice: Record<string, any>;
  environment?: string | null;
}) {
  const response = await fetch(`${getQuickBooksBaseUrl(input.environment)}/v3/company/${input.realmId}/invoice?minorversion=75`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input.invoice)
  });

  if (!response.ok) {
    throw await quickBooksError(response, "QuickBooks invoice creation failed");
  }

  const result = await response.json() as Record<string, any>;
  return result.Invoice ?? result;
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
    throw await quickBooksError(response, "QuickBooks invoice void failed");
  }

  return response.json() as Promise<Record<string, any>>;
}
