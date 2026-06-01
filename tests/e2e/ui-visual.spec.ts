import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const storageStatePath = process.env.E2E_STORAGE_STATE || process.env.PLAYWRIGHT_STORAGE_STATE;
const hasAdminCredentials = Boolean(adminEmail && adminPassword);
const hasStoredSession = Boolean(storageStatePath);
const primaryRoutes = ["/dashboard", "/cohorts", "/registrations", "/participants", "/payments", "/reports", "/settings"];

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
  });

  expect(Math.ceil(overflow)).toBeLessThanOrEqual(2);
}

async function expectStableSurfaces(page: Page) {
  const overflowing = await page.locator(
    [
      ".page-header",
      ".section-card",
      ".compact-filter-bar",
      ".app-table-shell",
      ".dashboard-panel",
      ".dashboard-metric-card",
      ".cohort-metric-card",
      ".cohort-revenue-card",
      ".quick-view-drawer"
    ].join(", ")
  ).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && box.width > 0 && box.height > 0;
      })
      .map((element) => ({
        className: element.className,
        overflow: Math.ceil(element.scrollWidth - element.clientWidth)
      }))
      .filter((item) => item.overflow > 2)
  );

  expect(overflowing).toEqual([]);
}

async function expectNoNativeSelects(page: Page) {
  await expect(page.locator("select")).toHaveCount(0);
}

async function login(page: Page) {
  if (hasStoredSession && !hasAdminCredentials) {
    await page.goto("/dashboard");
    await expect(page.locator(".app-shell")).toBeVisible();
    return;
  }

  test.skip(
    !hasAdminCredentials,
    "Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD or E2E_STORAGE_STATE to run authenticated UI checks."
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail!);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("public shell", () => {
  test("login page is stable and branded", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableSurfaces(page);
  });

  test("protected admin routes redirect to login when signed out", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });
});

test.describe("authenticated admin UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const route of primaryRoutes) {
    test(`${route} has stable layout surfaces`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      await expect(page.locator(".app-shell")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectStableSurfaces(page);
      await expectNoNativeSelects(page);
    });
  }

  test("global compact and night controls stay readable", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Compact" }).click();
    await page.getByLabel("Night mode").click();

    await expect(page.locator(".app-shell")).toHaveClass(/is-compact/);
    await expect(page.locator(".app-shell")).toHaveClass(/is-night/);
    await expectNoHorizontalOverflow(page);
    await expectStableSurfaces(page);
  });

  test("app dropdowns render with Mission Control styling", async ({ page }) => {
    await page.goto("/cohorts");
    await page.locator(".ui-select-trigger").first().click();
    await expect(page.locator(".ui-select-menu").first()).toBeVisible();
    await expectNoNativeSelects(page);
  });

  test("cohort detail uses checklist sessions and quick views", async ({ page }) => {
    await page.goto("/cohorts");
    await page.waitForLoadState("networkidle");

    const firstRow = page.locator("tbody tr").first();
    test.skip(await firstRow.count() === 0, "No cohorts are available for cohort detail UI checks.");

    await firstRow.click();
    await expect(page).toHaveURL(/\/cohorts\/[^/]+$/);
    await page.getByRole("button", { name: "Sessions" }).click();
    await expect(page.locator(".session-checklist")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableSurfaces(page);

    await page.getByRole("button", { name: "Registrations" }).click();
    const registrationRow = page.locator("tbody tr").first();
    if (await registrationRow.count()) {
      await registrationRow.click();
      await expect(page.locator(".quick-view-drawer")).toBeVisible();
      await expectStableSurfaces(page);
    }
  });
});
