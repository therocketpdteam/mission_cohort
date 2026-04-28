import { WebhookProcessingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function recordWebhookEvent(input: {
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  return prisma.webhookEvent.create({
    data: {
      ...input,
      status: WebhookProcessingStatus.RECEIVED
    }
  });
}
