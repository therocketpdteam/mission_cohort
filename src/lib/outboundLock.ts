import type { Prisma } from "@prisma/client";
import { env, getAppEnvironmentKind, getAppEnvironmentLabel } from "@/lib/env";
import { logAuditEvent } from "@/services/auditService";

export type OutboundChannel = "SENDGRID" | "GOOGLE_CALENDAR" | "CRM" | "QUICKBOOKS" | "BACKGROUND_JOBS";

export type OutboundLockState = {
  environment: ReturnType<typeof getAppEnvironmentKind>;
  label: string;
  required: boolean;
  locked: boolean;
  mode: "locked" | "unlocked" | "not_required";
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

  return {
    environment,
    label: getAppEnvironmentLabel(),
    required,
    locked,
    mode: locked ? "locked" : required ? "unlocked" : "not_required",
    reason: env.OUTBOUND_RELEASE_REASON
  };
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
