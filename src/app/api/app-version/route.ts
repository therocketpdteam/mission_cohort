import { NextResponse } from "next/server";
import { backgroundJobsAllowed, getAppEnvironmentKind, getAppEnvironmentLabel } from "@/lib/env";
import { getOutboundLockState } from "@/lib/outboundLock";
import packageJson from "../../../../package.json";

function version() {
  return process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.NEXT_PUBLIC_APP_VERSION
    || process.env.VERCEL_URL
    || packageJson.version
    || "local";
}

function shortVersion(value: string) {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return value.slice(0, 8);
  }

  if (process.env.VERCEL_URL) {
    return process.env.VERCEL_URL.match(/mission-cohort-([a-z0-9]+)-/)?.[1] ?? value.slice(0, 12);
  }

  return value.slice(0, 12);
}

export async function GET() {
  const value = version();

  return NextResponse.json(
    {
      success: true,
      data: {
        version: value,
        shortVersion: shortVersion(value),
        source: process.env.VERCEL_GIT_COMMIT_SHA
          ? "vercel-git"
          : process.env.NEXT_PUBLIC_APP_VERSION
            ? "app-version"
            : process.env.VERCEL_URL
              ? "vercel-deployment"
              : "package",
        environment: {
          kind: getAppEnvironmentKind(),
          label: getAppEnvironmentLabel(),
          vercelEnvironment: process.env.VERCEL_ENV || "local",
          backgroundJobsAllowed: backgroundJobsAllowed(),
          outbound: getOutboundLockState()
        }
      }
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      }
    }
  );
}
