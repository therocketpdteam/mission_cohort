import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

async function login(page: Page) {
  test.skip(!adminEmail || !adminPassword, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail!);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function registrationCount(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/registrations");
    if (!response.ok) throw new Error(`Registration request failed: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data.length : 0;
  });
}

test("manual registration remains unsaved until the final review confirmation", async ({ page }) => {
  await login(page);
  await page.goto("/registrations");
  await page.waitForLoadState("networkidle");

  const before = await registrationCount(page);
  await page.getByRole("button", { name: "Add Registration" }).click();

  const cohortField = page.locator(".registration-editor-modal label.ui-field").filter({ has: page.locator(".ui-label", { hasText: /^Cohort$/ }) });
  await cohortField.locator(".ui-select-trigger").click();
  await cohortField.locator(".ui-select-option").nth(1).click();

  const organizationField = page.locator(".registration-editor-modal label.ui-field").filter({ has: page.locator(".ui-label", { hasText: /^Organization$/ }) });
  await organizationField.locator("input.ui-autocomplete-input").fill("QA Sunshine Leadership School");
  await organizationField.locator(".ui-select-option").filter({ hasText: /QA Sunshine Leadership School/i }).click();

  await page.getByLabel("Primary contact", { exact: true }).fill("Review Test POC");
  await page.getByLabel("Primary contact email", { exact: true }).fill("review-poc@example.test");
  await page.getByLabel("Paste participant roster").fill([
    "Ada Lovelace, Math Coach, ada-review@example.test",
    "Grace Hopper, Principal, grace-review@example.test"
  ].join("\n"));
  await page.getByRole("button", { name: "Add 2" }).click();
  await expect(page.getByText("2 participants ready")).toBeVisible();

  await page.getByRole("button", { name: "Review Registration" }).click();
  await expect(page.getByText("Final review")).toBeVisible();
  await expect(page.getByText("ada-review@example.test")).toBeVisible();
  await expect(page.getByText("grace-review@example.test")).toBeVisible();
  await expect(page.getByText(/What happens after confirmation|Saved without outbound delivery/)).toBeVisible();

  expect(await registrationCount(page)).toBe(before);
  await expect(page.getByRole("button", { name: /Create (?:& Send|Registration)/ })).toBeVisible();
});
