export type OperationState = "pending" | "success" | "warning" | "error";
export type EntityChange = { entity: string; id?: string; values: Record<string, any>; method: string };
export type AdminOperation = {
  id: string; state: OperationState; message: string; href: string; origin: string; createdAt: number; finishedAt?: number;
  path?: string; method?: string; change?: EntityChange; result?: Record<string, any>; error?: string; dismissed?: boolean;
  onDismiss?: () => void; errorConfirmed?: boolean;
};

const fields: Record<string, string[]> = {
  participants: ["firstName", "lastName", "email", "title", "phone", "status", "certificateIssued", "certificateUrl", "registrationId", "cohortId", "organizationId"],
  registrations: ["primaryContactName", "primaryContactEmail", "primaryContactPhone", "primaryContactTitle", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPageUrl", "referrerUrl", "billingContactName", "billingContactEmail", "billingAddress", "participantCount", "participantListStatus", "totalAmount", "paymentMethod", "paymentStatus", "purchaseOrderNumber", "notes", "cohortId", "organizationId"],
  cohorts: ["title", "shortName", "slug", "description", "guideTopic", "guideUrl", "podcastUrl", "presenterId", "startDate", "endDate", "registrationOpenDate", "registrationCloseDate", "defaultTimezone", "minParticipants", "maxParticipants", "pricePerParticipant", "thumbnailUrl", "cohortType", "publicRegistrationEnabled", "prepResourcesOptional"],
  sessions: ["title", "description", "sessionNumber", "startTime", "endTime", "timezone", "meetingUrl", "location", "cohortId"],
  resources: ["title", "description", "type", "visibility", "url", "fileKey", "provider", "muxAssetId", "muxPlaybackId", "sessionId", "cohortId"],
  tasks: ["title", "description", "status", "priority", "category", "dueDate", "ownerName", "cohortId", "registrationId", "sessionId"],
  presenters: ["firstName", "lastName", "shortName", "email", "bio", "organization", "phone", "quickBooksVendorRef", "quickBooksExpenseAccountRef", "notes", "active"],
  organizations: ["name", "type", "website", "notes", "addressLine1", "addressLine2", "city", "state", "zip", "phone"]
};

export function describeEntityChange(path: string, method: string, body: unknown): EntityChange | undefined {
  const url = new URL(path, "https://local.invalid");
  const value = body && typeof body === "object" ? body as Record<string, any> : {};
  if (value.action || value.ids || !["POST", "PATCH", "DELETE"].includes(method)) return;
  let entity = url.pathname.split("/")[2], id = value.id ?? url.searchParams.get("id") ?? undefined;
  if (/^\/api\/cohorts\/[^/]+\/(sessions|tasks)$/.test(url.pathname)) entity = url.pathname.split("/")[4];
  else if (/^\/api\/cohorts\/[^/]+$/.test(url.pathname)) id = url.pathname.split("/")[3];
  else if (url.pathname === "/api/operations/tasks") entity = "tasks";
  else if (url.pathname.split("/").length > 3) return;
  if (!fields[entity]) return;
  const values: Record<string, any> = {};
  for (const key of fields[entity]) if (value[key] !== undefined && (typeof value[key] !== "object" || value[key] === null)) values[key] = value[key];
  if (["sessions", "tasks"].includes(entity) && url.pathname.includes("/cohorts/")) values.cohortId = url.pathname.split("/")[3];
  if (entity === "registrations" && Array.isArray(value.participants)) {
    values.participants = value.participants.map((row: Record<string, unknown>) => Object.fromEntries(fields.participants.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])));
    values.backgroundDelivery = value.backgroundDelivery === true;
  }
  if (entity === "cohorts" && Array.isArray(value.sessions)) values.sessions = value.sessions.map((row: Record<string, unknown>) => Object.fromEntries(fields.sessions.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])));
  if (!Object.keys(values).length && method !== "DELETE") return;
  return { entity, id: id ? String(id) : undefined, values, method };
}

export function operationDestination(path: string, body: any, origin: string, result?: any) {
  const change = describeEntityChange(path, body?.id ? "PATCH" : "POST", body);
  const registrationId = body?.registrationId ?? result?.registrationId ?? (change?.entity === "registrations" ? result?.id ?? body?.id : null);
  if (registrationId) return `/registrations?id=${encodeURIComponent(registrationId)}`;
  if (path.includes("/support-team")) return `/cohorts/${path.split("/")[3]}`;
  if (change?.entity === "participants") return `/participants${result?.id ?? body?.id ? `?id=${encodeURIComponent(result?.id ?? body.id)}` : ""}`;
  if (change?.entity === "cohorts") return change.id ?? result?.id ? `/cohorts/${change.id ?? result.id}` : "/cohorts";
  if (["sessions", "resources", "tasks"].includes(change?.entity ?? "") && (body?.cohortId ?? result?.cohortId ?? change?.values.cohortId)) return `/cohorts/${body?.cohortId ?? result?.cohortId ?? change?.values.cohortId}`;
  if (path.includes("communications")) return "/communications?tab=issues";
  if (path.includes("integration") || path.includes("settings")) return "/settings?tab=health";
  return origin;
}

export function mutationOutcome(value: unknown): { state: "success" | "warning"; detail?: string } {
  if (!value || typeof value !== "object") return { state: "success" };
  const row = value as Record<string, any>;
  const status = String(row.status ?? "").toLowerCase();
  if (row.success === false || ["failed", "needs_attention", "needs_review", "error", "blocked", "partial", "warning"].includes(status) || row.error || row.providerError || (Array.isArray(row.failed) && row.failed.length) || (typeof row.failed === "number" && row.failed > 0)) return { state: "warning", detail: String(row.error ?? row.providerError ?? "Some follow-up work needs review.") };
  if (["confirmationFailures", "emailFailures", "calendarFailures", "failedCount"].some((key) => Number(row[key] ?? 0) > 0) || ["errors", "failures", "blockers"].some((key) => Array.isArray(row[key]) && row[key].length)) return { state: "warning", detail: "Some follow-up work needs review. Open the record for details." };
  if (["pending", "paused", "syncing", "busy", "queued"].includes(status)) return { state: "warning", detail: String(row.error ?? "Saved. Follow-up processing is still pending.") };
  if (status === "pending_apply") return { state: "warning", detail: "Saved. Review and apply the registration’s delivery changes." };
  if (row.deliveryJob?.id && row.deliveryJob.status !== "COMPLETED") return row.deliveryJob.status === "FAILED" ? { state: "warning", detail: "Saved, but registration delivery needs review." } : { state: "warning", detail: "Saved. Registration delivery is continuing in the background." };
  for (const key of ["journey", "calendar", "calendarSync", "communication", "delivery", "cancellationEmail", "calendarCleanup"]) {
    const child = row[key];
    if (child === "pending") return { state: "warning", detail: "Saved. Follow-up changes are pending review." };
    const outcome = mutationOutcome(child);
    if (outcome.state === "warning") return outcome;
  }
  return { state: "success" };
}

const entityLabels: Record<string, string> = { participants: "Participant", registrations: "Registration", cohorts: "Cohort", sessions: "Session", resources: "Resource", tasks: "Task", organizations: "Organization", presenters: "Thought Leader" };
export function operationLabel(change: EntityChange | undefined, body?: any) {
  if (change) return `${entityLabels[change.entity]} ${change.method === "DELETE" ? "removal" : change.method === "POST" ? "addition" : "update"}`;
  return body?.action && /send|resend/i.test(body.action) ? "Email delivery" : "Update";
}

let operations: AdminOperation[] = [];
const listeners = new Set<() => void>();
let sequence = 0;
const empty: AdminOperation[] = [];
export const subscribeOperations = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const operationSnapshot = () => operations;
export const serverOperationSnapshot = () => empty;
function changed() { for (const listener of listeners) listener(); }
function persist() {
  if (typeof window === "undefined") return;
  // Only recoverable routine form fields are retained. Integration credentials,
  // arbitrary request bodies and email-send actions are never stored here.
  try { window.sessionStorage.setItem("mission-cohort-save-recovery", JSON.stringify(operations.filter((operation) => operation.change && !operation.dismissed && ["error", "pending"].includes(operation.state)).slice(-15).map(({ result: _result, onDismiss: _callback, ...operation }) => operation))); } catch {}
}
export function hydrateOperations() {
  if (typeof window === "undefined" || operations.length) return;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem("mission-cohort-save-recovery") ?? "[]") as AdminOperation[];
    operations = stored.filter((entry) => entry.id && entry.change && entry.path && describeEntityChange(entry.path, entry.method ?? "", entry.change.values)?.entity === entry.change.entity).map((entry) => ({ ...entry, state: "error", errorConfirmed: entry.state === "pending" ? false : entry.errorConfirmed, error: entry.state === "pending" ? "The page was reloaded before confirmation. Check the record before submitting this change again." : entry.error, message: "A previous save needs review" }));
    changed();
  } catch {}
}
export function beginOperation(path: string, method: string, body: unknown, origin: string) {
  const change = describeEntityChange(path, method, body);
  const id = `save-${Date.now()}-${++sequence}`;
  const operation: AdminOperation = { id, state: "pending", message: `${operationLabel(change, body)} in progress…`, origin, href: operationDestination(path, body, origin), createdAt: Date.now(), path, method, change };
  operations = [...operations.filter((entry) => entry.createdAt > Date.now() - 30 * 60_000 || ["pending", "warning", "error"].includes(entry.state)), operation]; persist(); changed();
  return operation;
}
export function finishOperation(id: string, result?: any, error?: unknown) {
  const operation = operations.find((entry) => entry.id === id);
  if (!operation) return;
  const outcome = error ? { state: "error" as const, detail: error instanceof Error ? error.message : String(error) } : mutationOutcome(result);
  operations = operations.map((entry) => entry.id !== id ? entry : { ...entry, state: outcome.state, result: entry.change ? result : undefined, error: error ? outcome.detail : undefined, errorConfirmed: error ? Boolean((error as { confirmedFailure?: boolean }).confirmedFailure) : undefined, finishedAt: Date.now(), message: error ? `${operationLabel(entry.change)} failed: ${outcome.detail}` : outcome.detail ?? `${operationLabel(entry.change)} confirmed.`, href: operationDestination(entry.path ?? "", { ...entry.change?.values, id: entry.change?.id }, entry.origin, result) });
  persist(); changed();
}
export function publishOperationNotice(input: Pick<AdminOperation, "message" | "state" | "href"> & { id?: string; onDismiss?: () => void }) {
  const id = input.id ?? `notice-${Date.now()}-${++sequence}`;
  const existing = operations.find((entry) => entry.id === id);
  if (existing && existing.message === input.message && existing.state === input.state && existing.href === input.href) return id;
  operations = [...operations.filter((entry) => entry.id !== id), { ...existing, ...input, id, createdAt: existing?.createdAt ?? Date.now(), origin: typeof window === "undefined" ? "/dashboard" : window.location.pathname, finishedAt: input.state === "pending" ? undefined : Date.now() }]; changed(); return id;
}
export function dismissOperation(id: string) {
  const notice = operations.find((entry) => entry.id === id);
  operations = operations.map((entry) => entry.id === id ? { ...entry, dismissed: true } : entry); notice?.onDismiss?.(); persist(); changed();
}
export function notifyLegacy(message: string, state: "success" | "error" | "warning") {
  const origin = typeof window === "undefined" ? "/dashboard" : window.location.pathname;
  const recent = [...operations].reverse().find((entry) => entry.path && entry.origin.split("?")[0] === origin && entry.finishedAt && Date.now() - entry.finishedAt < 1800 && (state === "error" ? entry.state === "error" : entry.state !== "error"));
  if (recent) {
    operations = operations.map((entry) => entry.id === recent.id ? { ...entry, message: entry.state === "warning" ? entry.message : message } : entry); changed(); return;
  }
  publishOperationNotice({ message, state, href: origin });
}
export function resetOperations() { operations = []; persist(); changed(); }

export function projectEntityRows<T extends Record<string, any>>(base: T[], entries: AdminOperation[], entity: string, scope: Record<string, string> = {}) {
  let rows: Record<string, any>[] = [...base];
  for (const operation of entries) {
    const change = operation.change;
    if (!change || change.entity !== entity || operation.state === "error") continue;
    const confirmed = operation.state !== "pending";
    const result = confirmed ? operation.result ?? {} : {};
    const id = change.id ?? result.id ?? `pending:${operation.id}`;
    const index = rows.findIndex((row) => row.id === id || row._operationId === operation.id);
    if (change.method === "DELETE") { rows = rows.filter((row) => row.id !== change.id); continue; }
    if (change.method !== "POST" && index < 0) continue;
    // Compare each snapshot afresh. Permanently acknowledging an earlier GET
    // would let a slower stale GET undo a later confirmed edit.
    if (confirmed && index >= 0 && result.updatedAt && rows[index].updatedAt && new Date(rows[index].updatedAt) >= new Date(result.updatedAt)) continue;
    const row: Record<string, any> = { ...(index >= 0 ? rows[index] : {}), ...change.values, ...result, id, _optimistic: !confirmed, _operationId: operation.id };
    if (Object.entries(scope).some(([key, value]) => row[key] !== value)) { if (index >= 0) rows.splice(index, 1); continue; }
    if (index >= 0) rows[index] = row; else rows.unshift({ participants: [], sessions: [], registrations: [], _count: { participants: 0, registrations: 0 }, status: entity === "participants" ? "REGISTERED" : entity === "registrations" ? "NEW" : entity === "tasks" ? "OPEN" : "DRAFT", createdAt: new Date(operation.createdAt).toISOString(), ...row });
  }
  return rows as T[];
}
