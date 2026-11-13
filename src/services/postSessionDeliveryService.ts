import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export { isScheduledPostSession } from "@/lib/postSessionSendNow";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const normalized = (email: string) => email.trim().toLowerCase();
const conflict = (message: string) => Object.assign(new Error(message), { code: "BAD_REQUEST", status: 409 });

type Envelope = { subject: string; bodyHtml: string; bodyText?: string | null; attachments: any[]; targets: Array<{ email: string; context: any }> };

// Audit records are durable delivery checkpoints, never a second scheduled job.
// STARTED is written immediately before the provider request. An interrupted or
// ambiguous request is blocked from retry until its provider outcome is reviewed.
export async function deliverScheduledPostSession(message: any, dependencies: {
  prepare: () => Promise<Envelope>;
  validate: (emails: string[]) => Promise<void>;
  send: (input: any, beforeProviderRequest: () => Promise<void>) => Promise<any>;
  snapshot: (result: any) => any;
  client?: typeof prisma;
}) {
  const client = dependencies.client ?? prisma;
  if (message.status === "SENT") return message;
  const claimed = await client.cohortCommunication.updateMany({ where: { id: message.id, scheduledFor: { not: null }, sentAt: null, status: { in: ["SCHEDULED", "FAILED"] } }, data: { status: "SENDING", providerError: null } });
  if (claimed.count !== 1) {
    const current = await client.cohortCommunication.findUniqueOrThrow({ where: { id: message.id } });
    if (current.status === "SENT") return current;
    throw conflict("This post-session email is already sending or is no longer scheduled. Refresh its status before trying again.");
  }
  try {
    const audienceId = `post-session:${message.id}:envelope`;
    let saved = await client.auditLog.findUnique({ where: { id: audienceId } });
    if (!saved) {
      const envelope = await dependencies.prepare();
      envelope.targets = [...new Map(envelope.targets.map(target => [normalized(target.email), { ...target, email: normalized(target.email) }])).values()];
      if (!envelope.targets.length) throw new Error("No recipients are configured for this post-session email.");
      await dependencies.validate(envelope.targets.map(target => target.email));
      saved = await client.auditLog.create({ data: { id: audienceId, entityType: "CohortCommunication", entityId: message.id, action: "POST_SESSION_ENVELOPE_SAVED", metadata: json(envelope) } });
    }
    const envelope = saved.metadata as unknown as Envelope;
    await dependencies.validate(envelope.targets.map(target => target.email));
    const previous = await client.emailEvent.findMany({ where: { communicationId: message.id, eventType: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED"] } }, select: { recipientEmail: true, createdAt: true } });
    const sent = new Set(previous.map(row => normalized(row.recipientEmail)));
    let latestAcceptedAt = previous.length ? new Date(Math.max(...previous.map(row => row.createdAt.getTime()))) : null;
    const problems: string[] = [];
    async function recordAccepted(email: string, receiptId: string, metadata: any) {
      const acceptedAt = new Date(metadata.acceptedAt);
      if (!latestAcceptedAt || acceptedAt > latestAcceptedAt) latestAcceptedAt = acceptedAt;
      await client.emailEvent.upsert({ where: { id: `${receiptId}:sent` }, create: { id: `${receiptId}:sent`, communicationId: message.id, recipientEmail: email, provider: "sendgrid", providerMessageId: metadata.providerMessageId, eventType: "SENT", eventPayload: metadata.snapshot, createdAt: acceptedAt }, update: {} });
    }
    for (const [index, target] of envelope.targets.entries()) {
      const receiptId = `post-session:${message.id}:${createHash("sha256").update(target.email).digest("hex")}`;
      const receipt = await client.auditLog.findUnique({ where: { id: receiptId } });
      if (receipt?.action === "POST_SESSION_ACCEPTED") {
        await recordAccepted(target.email, receiptId, receipt.metadata);
        continue;
      }
      if (sent.has(target.email)) continue;
      if (receipt?.action === "POST_SESSION_REQUEST_STARTED") {
        problems.push(`Delivery to ${target.email} needs provider verification before retrying; its outcome is uncertain.`);
        continue;
      }
      let requested = false;
      let accepted = false;
      try {
        const result = await dependencies.send({ to: target.email, subject: envelope.subject, bodyHtml: envelope.bodyHtml, bodyText: envelope.bodyText ?? undefined, attachments: envelope.attachments, context: target.context, outboundContext: { communicationId: message.id }, suppressQaBcc: index > 0 }, async () => {
          await client.auditLog.upsert({ where: { id: receiptId }, create: { id: receiptId, entityType: "CohortCommunication", entityId: message.id, action: "POST_SESSION_REQUEST_STARTED", metadata: { recipientEmail: target.email } }, update: { action: "POST_SESSION_REQUEST_STARTED", metadata: { recipientEmail: target.email } } });
          requested = true;
        });
        accepted = true;
        // Commit provider acceptance before writing secondary tracking events.
        const metadata = json({ recipientEmail: target.email, providerMessageId: result.providerMessageId, acceptedAt: new Date().toISOString(), snapshot: dependencies.snapshot(result) });
        await client.auditLog.update({ where: { id: receiptId }, data: { action: "POST_SESSION_ACCEPTED", metadata } });
        await recordAccepted(target.email, receiptId, metadata);
      } catch (error) {
        const uncertain = accepted || (requested && (error as any).deliveryUncertain !== false);
        if (requested && !uncertain) await client.auditLog.update({ where: { id: receiptId }, data: { action: "POST_SESSION_RETRYABLE", metadata: { recipientEmail: target.email } } });
        problems.push(uncertain ? `Delivery to ${target.email} needs provider verification before retrying; its outcome is uncertain.` : `${target.email}: ${(error as Error).message}`);
        // Stop after the first failure. Retrying resumes with unconfirmed recipients.
        break;
      }
    }
    if (problems.length) throw new Error(problems.join(" "));
    return await client.cohortCommunication.update({ where: { id: message.id }, data: { status: "SENT", sentAt: latestAcceptedAt ?? new Date(), providerError: null } });
  } catch (error) {
    await client.cohortCommunication.updateMany({ where: { id: message.id, status: "SENDING" }, data: { status: "FAILED", providerError: (error as Error).message } });
    throw error;
  }
}
