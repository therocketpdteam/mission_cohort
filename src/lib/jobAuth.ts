import { fail } from "@/lib/api";
import { backgroundJobsAllowed, env, getAppEnvironmentKind, getAppEnvironmentLabel } from "@/lib/env";
import { getOutboundLockState, outboundLockedMessage } from "@/lib/outboundLock";
import { logAuditEvent } from "@/services/auditService";

export function validateJobSecret(request: Request) {
  if (!env.CRON_SECRET) {
    return true;
  }

  const configuredSecret = env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = new URL(request.url).searchParams.get("secret");

  return headerSecret === configuredSecret || bearerSecret === configuredSecret || querySecret === configuredSecret;
}

export function validateJobRequest(request: Request) {
  if (!validateJobSecret(request)) {
    return fail("Invalid job secret", "FORBIDDEN", 403);
  }

  if (!backgroundJobsAllowed()) {
    return fail(
      `${getAppEnvironmentLabel()} background jobs are disabled. Set ALLOW_BACKGROUND_JOBS=true only for an isolated test environment.`,
      "FORBIDDEN",
      403
    );
  }

  const outbound = getOutboundLockState();
  if (outbound.locked) {
    return fail(outboundLockedMessage("BACKGROUND_JOBS", "background job processing"), "FORBIDDEN", 423);
  }

  return null;
}

export async function recordJobInvocation(request: Request, jobName: string) {
  await logAuditEvent({
    entityType: "BackgroundJob",
    entityId: jobName,
    action: "background_job.invoked",
    description: `${jobName} reached the application.`,
    metadata: {
      method: request.method,
      outboundLocked: getOutboundLockState().locked
    }
  });
}

export function jobEnvironmentSnapshot() {
  return {
    environment: getAppEnvironmentKind(),
    label: getAppEnvironmentLabel(),
    backgroundJobsAllowed: backgroundJobsAllowed(),
    outbound: getOutboundLockState()
  };
}
