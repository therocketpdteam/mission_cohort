import { beginOperation, describeEntityChange, finishOperation } from "./adminOperations";

export type ApiEnvelope<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        message: string;
        code: string;
      };
    };

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  notify?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();

  if (!text) {
    if (response.ok) {
      return undefined as T;
    }

    throw new Error(`Request failed (${response.status}) for ${path}`);
  }

  let payload: ApiEnvelope<T>;

  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    const message = response.ok
      ? `Expected JSON response from ${path}`
      : `Request failed (${response.status}) for ${path}`;

    throw new Error(message);
  }

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    throw new Error(`Unexpected API response from ${path}`);
  }

  if (!payload.success) {
    throw Object.assign(new Error(payload.error?.message ?? `Request failed (${response.status}) for ${path}`), { confirmedFailure: response.status >= 400 && response.status < 500 });
  }

  return payload.data;
}

const activeRequests = new Map<string, Promise<any>>();
const entityQueues = new Map<string, Promise<any>>();

export async function adminApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  if (method === "GET" || options.notify === false || typeof window === "undefined") return request<T>(path, options);
  const change = describeEntityChange(path, method, options.body);
  const fingerprint = change ? JSON.stringify([path, method, options.body]) : "";
  if (fingerprint && activeRequests.has(fingerprint)) return activeRequests.get(fingerprint)!;
  const resource = change?.id ? `${change.entity}:${change.id}` : "";
  const prior = resource ? entityQueues.get(resource) : null;
  const operation = beginOperation(path, method, options.body, `${window.location.pathname}${window.location.search}`);
  const promise = (async () => {
    if (prior) await prior.catch(() => undefined);
    try {
      const result = await request<T>(path, options);
      finishOperation(operation.id, result);
      return result;
    } catch (error) {
      finishOperation(operation.id, undefined, error);
      throw error;
    }
  })();
  if (fingerprint) activeRequests.set(fingerprint, promise);
  if (resource) entityQueues.set(resource, promise);
  try { return await promise; }
  finally {
    if (fingerprint && activeRequests.get(fingerprint) === promise) activeRequests.delete(fingerprint);
    if (resource && entityQueues.get(resource) === promise) entityQueues.delete(resource);
  }
}

export async function uploadAdminFile<T>(file: File, purpose: string) {
  const body = new FormData();
  body.append("purpose", purpose);
  body.append("file", file);

  const response = await fetch("/api/uploads", {
    method: "POST",
    body
  });
  const payload = await response.json() as ApiEnvelope<T>;

  if (!payload.success) {
    throw new Error(payload.error?.message ?? "Upload failed");
  }

  return payload.data;
}
