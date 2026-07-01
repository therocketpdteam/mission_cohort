import { handleApiError, ok } from "@/lib/api";
import { MUTATION_ROLES, requireRole } from "@/lib/auth";
import { getIntegrationSetups, saveIntegrationSetup } from "@/services/integrationSetupService";
import { listConnectedGoogleCalendars } from "@/services/calendarService";
import { listQuickBooksAccountingRefs } from "@/services/quickBooksService";
import { getOutboundAutomationAudit, resetUnsentCohortAutomation } from "@/services/outboundResetService";
import { Role } from "@prisma/client";

export async function GET(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const params = new URL(request.url).searchParams;

    if (params.get("provider") === "GOOGLE_CALENDAR" && params.get("action") === "listCalendars") {
      return ok(await listConnectedGoogleCalendars());
    }

    if (params.get("provider") === "QUICKBOOKS" && params.get("action") === "listAccountingRefs") {
      return ok(await listQuickBooksAccountingRefs());
    }

    if (params.get("action") === "outboundAudit") {
      await requireRole([Role.SUPER_ADMIN]);
      return ok(await getOutboundAutomationAudit());
    }

    return ok(await getIntegrationSetups());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(MUTATION_ROLES);
    const body = await request.json();

    if (body.action === "resetUnsentAutomation") {
      await requireRole([Role.SUPER_ADMIN]);
      if (body.confirmation !== "RESET_UNSENT_AUTOMATION") {
        throw Object.assign(new Error("Exact reset confirmation is required."), { code: "BAD_REQUEST", status: 400 });
      }
      return ok(await resetUnsentCohortAutomation({ excludeCohortId: body.excludeCohortId }));
    }

    return ok(await saveIntegrationSetup(body.provider, body));
  } catch (error) {
    return handleApiError(error);
  }
}
