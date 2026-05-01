import { handleApiError, ok } from "@/lib/api";
import { completeQuickBooksOAuth } from "@/services/quickBooksService";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");

    if (!code) {
      throw Object.assign(new Error("QuickBooks OAuth code is required."), { code: "BAD_REQUEST", status: 400 });
    }

    const connection = await completeQuickBooksOAuth(code, realmId);
    return ok({
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      accountName: connection.accountName,
      realmId: connection.realmId,
      tokenExpiresAt: connection.tokenExpiresAt
    });
  } catch (error) {
    return handleApiError(error);
  }
}
