import { handleApiError, ok } from "@/lib/api";
import { getSharedReport } from "@/services/reportService";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return ok(await getSharedReport(token));
  } catch (error) {
    return handleApiError(error);
  }
}
