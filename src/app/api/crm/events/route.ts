import { handleApiError, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { Role } from "@prisma/client";
import {
  listCrmSyncEvents,
  processCrmSyncEvents,
  replayHistoricalCrmRegistrationEvents,
  summarizeCrmSyncEvents
} from "@/services/crmSyncService";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;

    if (searchParams.get("summary") === "1") {
      await requireRole([Role.SUPER_ADMIN]);
      const shortNames = searchParams.get("shortNames")?.split(",") ?? [];
      return ok(await summarizeCrmSyncEvents(shortNames, searchParams.get("receiver") === "1"));
    }

    return ok(await listCrmSyncEvents());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole([Role.SUPER_ADMIN]);
    const body = await request.json().catch(() => ({}));
    if (body.action === "replayHistoricalRegistrations") {
      return ok(
        await replayHistoricalCrmRegistrationEvents({
          shortNames: Array.isArray(body.shortNames) ? body.shortNames : [],
          dryRun: body.dryRun !== false,
          limit: body.limit,
          force: body.force === true
        }),
        { status: 202 }
      );
    }

    return ok(await processCrmSyncEvents(body.limit), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
