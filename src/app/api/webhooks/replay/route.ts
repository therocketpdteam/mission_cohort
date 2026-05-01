import { fail, handleApiError, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { processQuickBooksWebhook } from "@/services/quickBooksService";
import { processRegistrationWebhook } from "@/services/webhookService";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.id) {
      return fail("id is required", "BAD_REQUEST", 400);
    }

    const event = await prisma.webhookEvent.findUnique({ where: { id: body.id } });

    if (!event) {
      return fail("Webhook event not found", "NOT_FOUND", 404);
    }

    if (event.source === "quickbooks") {
      return ok(await processQuickBooksWebhook(JSON.stringify(event.payload), null, true), { status: 202 });
    }

    return ok(await processRegistrationWebhook(event.payload as Record<string, any>), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
