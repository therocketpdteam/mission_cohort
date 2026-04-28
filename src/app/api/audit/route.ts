import { fail, handleApiError, ok } from "@/lib/api";
import { listAuditEventsForEntity } from "@/services/auditService";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const entityType = params.get("entityType");
    const entityId = params.get("entityId");

    if (!entityType || !entityId) {
      return fail("entityType and entityId are required", "BAD_REQUEST", 400);
    }

    return ok(await listAuditEventsForEntity(entityType, entityId));
  } catch (error) {
    return handleApiError(error);
  }
}
