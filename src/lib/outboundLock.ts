import type { Prisma } from "@prisma/client";
import { env, getAppEnvironmentKind, getAppEnvironmentLabel } from "@/lib/env";
import { logAuditEvent } from "@/services/auditService";

export type OutboundChannel = "SENDGRID" | "GOOGLE_CALENDAR" | "CRM" | "QUICKBOOKS" | "BACKGROUND_JOBS";

export type OutboundLockState = {
  environment: ReturnType<typeof getAppEnvironmentKind>;
  label: string;
  required: boolean;
  locked: boolean;
  mode: "locked" | "restricted" | "unlocked" | "not_required";
  reason?: string;
};

function rawLockValue() {
  return String(env.OUTBOUND_RELEASE_LOCK ?? "").trim().toLowerCase();
}

export function getOutboundLockState(): OutboundLockState {
  const environment = getAppEnvironmentKind();
  const required = environment === "production" || rawLockValue() === "locked";
  const unlocked = rawLockValue() === "unlocked";
  const locked = required && !unlocked;
  const restricted = locked && String(env.OUTBOUND_RELEASE_MODE ?? "").trim().toLowerCase() === "restricted";

  return {
    environment,
    label: getAppEnvironmentLabel(),
    required,
    locked,
    mode: restricted ? "restricted" : locked ? "locked" : required ? "unlocked" : "not_required",
    reason: env.OUTBOUND_RELEASE_REASON
  };
}

function csvSet(value?: string) {
  return new Set(String(value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function restrictedReleaseAllows(input: Parameters<typeof assertOutboundUnlocked>[0]) {
  if (String(env.OUTBOUND_RELEASE_MODE ?? "").trim().toLowerCase() !== "restricted") return false;
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};

  if (input.channel === "SENDGRID") {
    const communicationId = String(metadata.communicationId ?? "").toLowerCase();
    return csvSet(env.OUTBOUND_RELEASE_ALLOWED_COMMUNICATION_IDS).has(communicationId);
  }

  if (input.channel === "GOOGLE_CALENDAR") {
    const cohortId = String(metadata.cohortId ?? "").toLowerCase();
    const recipients = Array.isArray(metadata.missingRecipients)
      ? metadata.missingRecipients.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];
    const allowedRecipients = csvSet(env.OUTBOUND_RELEASE_ALLOWED_RECIPIENTS);
    return csvSet(env.OUTBOUND_RELEASE_ALLOWED_COHORT_IDS).has(cohortId)
      && recipients.length > 0
      && recipients.every((recipient) => allowedRecipients.has(recipient));
  }

  return false;
}

export function outboundLockedMessage(channel: OutboundChannel, action: string) {
  const state = getOutboundLockState();
  return `${state.label} outbound is locked. ${channel} ${action} was blocked. Set OUTBOUND_RELEASE_LOCK=unlocked only for an intentional release/action, then lock it again.`;
}

export async function assertOutboundUnlocked(input: {
  channel: OutboundChannel;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const state = getOutboundLockState();

  if (!state.locked) {
    return state;
  }

  if (restrictedReleaseAllows(input)) {
    await logAuditEvent({
      entityType: input.entityType ?? "OutboundReleaseLock",
      entityId: input.entityId ?? input.channel,
      action: "outbound.restricted_allowed",
      description: `${state.label} restricted outbound allowlist permitted ${input.channel} ${input.action}.`,
      metadata: { channel: input.channel, action: input.action, lock: state, releaseMetadata: input.metadata }
    }).catch(() => undefined);
    return state;
  }

  await logAuditEvent({
    entityType: input.entityType ?? "OutboundReleaseLock",
    entityId: input.entityId ?? input.channel,
    action: "outbound.blocked",
    description: outboundLockedMessage(input.channel, input.action),
    metadata: {
      channel: input.channel,
      action: input.action,
      lock: state,
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : { metadata: input.metadata })
    }
  }).catch(() => undefined);

  throw Object.assign(new Error(outboundLockedMessage(input.channel, input.action)), {
    code: "FORBIDDEN",
    status: 423
  });
}
