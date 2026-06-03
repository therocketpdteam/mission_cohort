import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

function readEnvValue(key: string) {
  for (const file of [".env.local", ".env.vercel.local", ".env"]) {
    if (!existsSync(file)) {
      continue;
    }

    const match = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (match?.[1]) {
      return match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return undefined;
}

const isUiAudit = process.argv.some((arg) => arg.includes("ui-audit.spec"));
const auditBaseURL = process.env.APP_BASE_URL ?? readEnvValue("APP_BASE_URL");
const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? (isUiAudit ? auditBaseURL : undefined);
const baseURL = configuredBaseURL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const storageState = process.env.E2E_STORAGE_STATE || process.env.PLAYWRIGHT_STORAGE_STATE;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    storageState: storageState || undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: configuredBaseURL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 920 } }
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] }
    }
  ]
});
