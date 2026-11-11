import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "payment-documents.spec.ts", workers: 1, timeout: 45000,
  reporter: "list", outputDir: "../../test-results/payment-documents",
  use: { headless: true, channel: process.env.HISTORY_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined, viewport: { width: 1280, height: 1000 }, screenshot: "only-on-failure" }
});
