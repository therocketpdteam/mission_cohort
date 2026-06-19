import { handleApiError } from "@/lib/api";
import { getQuickBooksOAuthUrl } from "@/services/quickBooksService";

export async function GET() {
  try {
    return Response.redirect(await getQuickBooksOAuthUrl(), 302);
  } catch (error) {
    return handleApiError(error);
  }
}
