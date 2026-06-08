import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

function version() {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "local";
}

export async function GET() {
  const value = version();

  return NextResponse.json(
    {
      success: true,
      data: {
        version: value,
        shortVersion: value.slice(0, 8),
        source: process.env.VERCEL_GIT_COMMIT_SHA ? "vercel-git" : process.env.NEXT_PUBLIC_APP_VERSION ? "app-version" : "package"
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
