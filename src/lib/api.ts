import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

type SafeError = Error & {
  code?: ApiErrorCode;
  status?: number;
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(message: string, code: ApiErrorCode, status = 500) {
  return NextResponse.json(
    {
      success: false,
      error: {
        message,
        code
      }
    },
    { status }
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return fail(error.issues.map((issue) => issue.message).join("; "), "BAD_REQUEST", 400);
  }

  const safeError = error as SafeError;

  if (safeError?.code && safeError?.status) {
    return fail(safeError.message, safeError.code, safeError.status);
  }

  console.error(error);
  return fail("Unexpected server error", "INTERNAL_ERROR", 500);
}

export async function readJson<T>(request: Request, parser: { parse: (value: unknown) => T }) {
  const body = await request.json();
  return parser.parse(body);
}
