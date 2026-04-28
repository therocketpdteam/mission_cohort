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
};

export async function adminApi<T>(path: string, options: RequestOptions = {}) {
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
    throw new Error(payload.error?.message ?? `Request failed (${response.status}) for ${path}`);
  }

  return payload.data;
}
