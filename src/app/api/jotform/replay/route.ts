import { fail, handleApiError, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { replayJotformWebhookEvent } from "@/services/jotformIntakeService";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    const event = await prisma.webhookEvent.findUnique({
      where: { id: body.id },
      select: { eventType: true }
    });
    const recoveredSubmission = event?.eventType === "registration.reconciliation_missing";

    if (recoveredSubmission && body.mode !== "import_only") {
      return fail("Recovered submissions require import-only mode. This prevents accidental emails, calendar invitations, CRM sync, and QuickBooks activity.", "BAD_REQUEST", 400);
    }

    return ok(await replayJotformWebhookEvent(body.id, { importOnly: recoveredSubmission }), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
