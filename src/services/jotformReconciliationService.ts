import { IntegrationConnectionStatus, IntegrationProvider, Prisma, WebhookProcessingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDecryptedIntegrationConnection, upsertIntegrationConnection } from "@/services/integrationService";
import { listActiveJotformFormMappings } from "@/services/jotformMappingService";

const JOTFORM_API_BASE = "https://api.jotform.com";
const RECONCILIATION_LABEL = "reconciliation";

type JotformSubmission = {
  id?: string;
  form_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  answers?: Record<string, unknown>;
};

export function missingSubmissionIds(
  submissionIds: string[],
  knownEventIds: string[],
  knownRegistrationIds: string[]
) {
  const known = new Set([...knownEventIds, ...knownRegistrationIds].filter(Boolean));
  return Array.from(new Set(submissionIds.filter(Boolean))).filter((id) => !known.has(id));
}

function metadata(value: unknown) {
  return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
}

function submissionPayload(submission: JotformSubmission, formId: string) {
  return {
    source: "jotform",
    eventType: "registration.reconciliation_missing",
    formID: submission.form_id || formId,
    submissionID: submission.id,
    created_at: submission.created_at,
    updated_at: submission.updated_at,
    status: submission.status,
    answers: submission.answers ?? {},
    reconciliation: {
      detectedAt: new Date().toISOString(),
      source: "jotform_api",
      automaticReplay: false
    }
  };
}

async function fetchRecentSubmissions(apiKey: string, formId: string, limit: number) {
  const url = new URL(`${JOTFORM_API_BASE}/form/${encodeURIComponent(formId)}/submissions`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("orderby", "created_at");
  url.searchParams.set("direction", "DESC");

  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok || Number(body.responseCode ?? response.status) >= 400) {
    const message = String(body.message ?? body.responseCode ?? `HTTP ${response.status}`);
    throw new Error(`Jotform form ${formId} could not be reconciled: ${message}`);
  }

  return Array.isArray(body.content) ? body.content as JotformSubmission[] : [];
}

export async function getJotformReconciliationSetup() {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider_label: { provider: IntegrationProvider.JOTFORM, label: RECONCILIATION_LABEL } }
  });
  const data = metadata(connection?.metadata);

  return {
    configured: Boolean(connection?.accessToken),
    status: connection?.status ?? IntegrationConnectionStatus.NOT_CONFIGURED,
    lastCheckedAt: connection?.lastSyncedAt ?? null,
    lastResult: data.lastResult ?? null,
    errorMessage: connection?.errorMessage ?? null,
    automaticReplay: false
  };
}

export async function saveJotformReconciliationApiKey(apiKey: string) {
  const cleanApiKey = apiKey.trim();
  if (!cleanApiKey) {
    throw Object.assign(new Error("Jotform API key is required."), { code: "BAD_REQUEST", status: 400 });
  }

  await upsertIntegrationConnection({
    provider: IntegrationProvider.JOTFORM,
    label: RECONCILIATION_LABEL,
    status: IntegrationConnectionStatus.CONNECTED,
    accountName: "Jotform reconciliation",
    accessToken: cleanApiKey,
    metadata: { automaticReplay: false }
  });

  return getJotformReconciliationSetup();
}

export async function reconcileJotformSubmissions(options?: { limitPerForm?: number; lookbackDays?: number }) {
  const connection = await getDecryptedIntegrationConnection(IntegrationProvider.JOTFORM, RECONCILIATION_LABEL);
  if (!connection?.accessToken) {
    throw Object.assign(new Error("Configure the Jotform reconciliation API key first."), { code: "BAD_REQUEST", status: 400 });
  }

  const limitPerForm = Math.min(Math.max(options?.limitPerForm ?? 100, 1), 1000);
  const lookbackDays = Math.min(Math.max(options?.lookbackDays ?? 45, 1), 365);
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const mappings = await listActiveJotformFormMappings();
  const formIds = Array.from(new Set(mappings.map((mapping) => mapping.formId).filter(Boolean)));
  const summary = {
    checkedAt: new Date().toISOString(),
    formsChecked: formIds.length,
    submissionsChecked: 0,
    alreadyImported: 0,
    missingDetected: 0,
    skippedOutsideWindow: 0,
    createdEventIds: [] as string[],
    errors: [] as string[],
    automaticReplay: false
  };

  for (const formId of formIds) {
    try {
      const submissions = await fetchRecentSubmissions(connection.accessToken, formId, limitPerForm);
      const recent = submissions.filter((submission) => {
        const createdAt = submission.created_at ? new Date(submission.created_at) : null;
        if (createdAt && !Number.isNaN(createdAt.getTime()) && createdAt < cutoff) {
          summary.skippedOutsideWindow += 1;
          return false;
        }
        return Boolean(submission.id);
      });
      summary.submissionsChecked += recent.length;
      const submissionIds = recent.map((submission) => String(submission.id));
      const [events, registrations] = await Promise.all([
        prisma.webhookEvent.findMany({
          where: { externalSubmissionId: { in: submissionIds } },
          select: { externalSubmissionId: true }
        }),
        prisma.registration.findMany({
          where: { externalSubmissionId: { in: submissionIds } },
          select: { externalSubmissionId: true }
        })
      ]);
      const missingIds = new Set(missingSubmissionIds(
        submissionIds,
        events.map((event) => event.externalSubmissionId ?? ""),
        registrations.map((registration) => registration.externalSubmissionId ?? "")
      ));
      summary.alreadyImported += recent.length - missingIds.size;

      for (const submission of recent) {
        const submissionId = String(submission.id ?? "");
        if (!missingIds.has(submissionId)) continue;

        const existing = await prisma.webhookEvent.findFirst({ where: { externalSubmissionId: submissionId } });
        if (existing) {
          summary.alreadyImported += 1;
          continue;
        }

        const event = await prisma.webhookEvent.create({
          data: {
            source: "jotform",
            eventType: "registration.reconciliation_missing",
            payload: submissionPayload(submission, formId) as Prisma.InputJsonValue,
            externalSubmissionId: submissionId,
            status: WebhookProcessingStatus.RECEIVED,
            errorMessage: "Detected by Jotform reconciliation. Review before importing; no communications were sent."
          }
        });
        summary.missingDetected += 1;
        summary.createdEventIds.push(event.id);
      }
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : `Jotform form ${formId} reconciliation failed.`);
    }
  }

  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      status: summary.errors.length ? IntegrationConnectionStatus.ERROR : IntegrationConnectionStatus.CONNECTED,
      lastSyncedAt: new Date(),
      errorMessage: summary.errors.join(" ") || null,
      metadata: { ...metadata(connection.metadata), automaticReplay: false, lastResult: summary } as Prisma.InputJsonValue
    }
  });

  return summary;
}
