import { fail, handleApiError, ok } from "@/lib/api";
import {
  createCommunicationDraft,
  createPlannedSessionReminders,
  listCommunicationsByCohort,
  processScheduledCommunications,
  scheduleCommunicationPlaceholder,
  sendCommunicationPlaceholder
} from "@/services/communicationService";

export async function GET(request: Request) {
  try {
    const cohortId = new URL(request.url).searchParams.get("cohortId");

    if (!cohortId) {
      return fail("cohortId query parameter is required", "BAD_REQUEST", 400);
    }

    return ok(await listCommunicationsByCohort(cohortId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createCommunicationDraft(await request.json()), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "schedule") {
      return ok(await scheduleCommunicationPlaceholder(body));
    }

    if (body.action === "scheduleSessionReminders") {
      return ok(await createPlannedSessionReminders(body.sessionId, body.createdById));
    }

    if (body.action === "send" || body.action === "resend") {
      if (!body.id) {
        return fail("id is required", "BAD_REQUEST", 400);
      }

      return ok(await sendCommunicationPlaceholder(body.id));
    }

    if (body.action === "processScheduled") {
      return ok(await processScheduledCommunications(body.limit));
    }

    return fail("Unsupported communication action", "BAD_REQUEST", 400);
  } catch (error) {
    return handleApiError(error);
  }
}
