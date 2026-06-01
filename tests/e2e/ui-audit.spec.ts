import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Severity = "high" | "medium" | "low";

type AuditFinding = {
  route: string;
  viewport: string;
  severity: Severity;
  area: string;
  message: string;
};

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const storageStatePath = process.env.E2E_STORAGE_STATE || process.env.PLAYWRIGHT_STORAGE_STATE;
const hasAdminCredentials = Boolean(adminEmail && adminPassword);
const hasStoredSession = Boolean(storageStatePath);

const staticRoutes = ["/dashboard", "/cohorts", "/registrations", "/participants", "/payments", "/reports", "/settings"];

function finding(route: string, viewport: string, severity: Severity, area: string, message: string): AuditFinding {
  return { route, viewport, severity, area, message };
}

function formatFindings(findings: AuditFinding[]) {
  if (findings.length === 0) {
    return "# Playwright UI Audit\n\nNo findings.\n";
  }

  const byRoute = new Map<string, AuditFinding[]>();
  for (const item of findings) {
    byRoute.set(item.route, [...(byRoute.get(item.route) ?? []), item]);
  }

  return [
    "# Playwright UI Audit",
    "",
    ...Array.from(byRoute.entries()).flatMap(([route, routeFindings]) => [
      `## ${route}`,
      "",
      ...routeFindings.map((item) => `- **${item.severity.toUpperCase()}** [${item.viewport}] ${item.area}: ${item.message}`),
      ""
    ])
  ].join("\n");
}

async function writeAuditReport(testInfo: TestInfo, findings: AuditFinding[]) {
  const reportPath = testInfo.outputPath("ui-audit.md");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatFindings(findings), "utf8");
  await testInfo.attach("ui-audit.md", { path: reportPath, contentType: "text/markdown" });
}

async function login(page: Page) {
  if (hasStoredSession && !hasAdminCredentials) {
    await page.goto("/dashboard");
    await expect(page.locator(".app-shell")).toBeVisible();
    return;
  }

  test.skip(
    !hasAdminCredentials,
    "Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD or E2E_STORAGE_STATE to run authenticated UI audits."
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail!);
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function collectCohortDetailRoute(page: Page) {
  await page.goto("/cohorts");
  await page.waitForLoadState("networkidle");
  const firstRow = page.locator("tbody tr").first();
  if (await firstRow.count() === 0) {
    return null;
  }

  await firstRow.click();
  await expect(page).toHaveURL(/\/cohorts\/[^/]+$/);
  return new URL(page.url()).pathname;
}

async function collectLayoutFindings(page: Page, route: string, viewport: string) {
  return page.evaluate(
    ({ route, viewport }) => {
      const findings: AuditFinding[] = [];
      const root = document.documentElement;
      const pageOverflow = Math.ceil(Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth);

      if (pageOverflow > 2) {
        findings.push({
          route,
          viewport,
          severity: "high",
          area: "page overflow",
          message: `Page scrollWidth exceeds viewport by ${pageOverflow}px.`
        });
      }

      const surfaceSelector = [
        ".page-header",
        ".section-card",
        ".compact-filter-bar",
        ".app-table-shell",
        ".dashboard-panel",
        ".dashboard-metric-card",
        ".cohort-metric-card",
        ".cohort-revenue-card",
        ".quick-view-drawer",
        ".session-check-row",
        ".participant-bulk-bar"
      ].join(", ");

      document.querySelectorAll<HTMLElement>(surfaceSelector).forEach((element) => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.display === "none" || box.width === 0 || box.height === 0) {
          return;
        }

        const overflow = Math.ceil(element.scrollWidth - element.clientWidth);
        if (overflow > 2) {
          findings.push({
            route,
            viewport,
            severity: "medium",
            area: "surface overflow",
            message: `${element.className || element.tagName} overflows horizontally by ${overflow}px.`
          });
        }
      });

      const nativeSelectCount = document.querySelectorAll("select").length;
      if (nativeSelectCount > 0) {
        findings.push({
          route,
          viewport,
          severity: "medium",
          area: "native select",
          message: `${nativeSelectCount} native select element(s) found; use app-styled dropdowns.`
        });
      }

      document.querySelectorAll<HTMLElement>(".ui-button, .ui-icon-button, .status-chip, .metadata-pill").forEach((element) => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.display === "none" || box.width === 0 || box.height === 0) {
          return;
        }

        const horizontalClip = Math.ceil(element.scrollWidth - element.clientWidth);
        const verticalClip = Math.ceil(element.scrollHeight - element.clientHeight);
        if (horizontalClip > 2 || verticalClip > 2) {
          findings.push({
            route,
            viewport,
            severity: "medium",
            area: "clipped control",
            message: `${element.className || element.tagName} clips content by ${horizontalClip}px horizontal / ${verticalClip}px vertical.`
          });
        }
      });

      const interactive = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, textarea, .ui-select-trigger"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        })
        .map((element) => ({ element, box: element.getBoundingClientRect() }));

      for (let index = 0; index < interactive.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < interactive.length; nextIndex += 1) {
          const first = interactive[index]!;
          const second = interactive[nextIndex]!;
          if (first.element.contains(second.element) || second.element.contains(first.element)) {
            continue;
          }
          if (
            first.element.closest(".ui-select-menu, .row-action-menu, .user-popover") ||
            second.element.closest(".ui-select-menu, .row-action-menu, .user-popover")
          ) {
            continue;
          }

          const x = Math.max(0, Math.min(first.box.right, second.box.right) - Math.max(first.box.left, second.box.left));
          const y = Math.max(0, Math.min(first.box.bottom, second.box.bottom) - Math.max(first.box.top, second.box.top));
          if (x > 4 && y > 4) {
            findings.push({
              route,
              viewport,
              severity: "medium",
              area: "overlapping controls",
              message: `${first.element.tagName.toLowerCase()} overlaps ${second.element.tagName.toLowerCase()} by ${Math.round(x)}x${Math.round(y)}px.`
            });
          }
        }
      }

      return findings;
    },
    { route, viewport }
  );
}

async function auditRoute(page: Page, route: string, viewport: string, findings: AuditFinding[]) {
  const consoleErrors: string[] = [];
  const requestErrors: string[] = [];

  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };
  const onRequestFailed = (request: { resourceType: () => string; failure: () => { errorText: string } | null; url: () => string }) => {
    const resourceType = request.resourceType();
    const errorText = request.failure()?.errorText ?? "unknown";
    if (["document", "fetch", "xhr"].includes(resourceType) && !errorText.includes("ERR_ABORTED")) {
      requestErrors.push(`${request.url()} ${errorText}`);
    }
  };

  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);

  try {
    const response = await page.goto(route);
    await page.waitForLoadState("networkidle");

    if (!response || response.status() >= 400) {
      findings.push(finding(route, viewport, "high", "navigation", `Route returned status ${response?.status() ?? "unknown"}.`));
    }

    if (await page.locator(".app-shell").count() === 0) {
      findings.push(finding(route, viewport, "high", "app shell", "Authenticated admin shell is not visible."));
    }

    findings.push(...await collectLayoutFindings(page, route, viewport));

    if (consoleErrors.length > 0) {
      findings.push(finding(route, viewport, "high", "console", consoleErrors.slice(0, 5).join(" | ")));
    }

    if (requestErrors.length > 0) {
      findings.push(finding(route, viewport, "high", "request", requestErrors.slice(0, 5).join(" | ")));
    }
  } catch (error) {
    findings.push(finding(route, viewport, "high", "audit runtime", error instanceof Error ? error.message : String(error)));
  } finally {
    page.off("console", onConsole);
    page.off("requestfailed", onRequestFailed);
  }
}

test.describe("Playwright UI audit", () => {
  test("audits authenticated admin routes and writes a grouped report", async ({ page }, testInfo) => {
    await login(page);

    const viewport = testInfo.project.name;
    const findings: AuditFinding[] = [];
    const cohortDetailRoute = await collectCohortDetailRoute(page);
    const routes = cohortDetailRoute ? [...staticRoutes, cohortDetailRoute] : staticRoutes;

    for (const route of routes) {
      await auditRoute(page, route, viewport, findings);

      if (route === "/dashboard") {
        await page.getByRole("button", { name: "Compact" }).click();
        await page.getByLabel("Night mode").click();
        findings.push(...await collectLayoutFindings(page, `${route} compact/night`, viewport));
      }

      if (route === "/cohorts" && await page.locator(".ui-select-trigger").count()) {
        try {
          await page.locator(".ui-select-trigger").first().click({ timeout: 3_000 });
          if (await page.locator(".ui-select-menu").first().isVisible()) {
            findings.push(...await collectLayoutFindings(page, `${route} dropdown`, viewport));
          } else {
            findings.push(finding(route, viewport, "medium", "dropdown", "App dropdown trigger did not open a visible menu."));
          }
        } catch (error) {
          findings.push(finding(route, viewport, "medium", "dropdown", error instanceof Error ? error.message : String(error)));
        }
      }

      if (route === cohortDetailRoute) {
        await page.getByRole("button", { name: "Sessions" }).click();
        if (await page.locator(".session-checklist").count() === 0) {
          findings.push(finding(route, viewport, "medium", "sessions", "Session checklist was not visible on cohort detail."));
        }
        findings.push(...await collectLayoutFindings(page, `${route} sessions`, viewport));
      }
    }

    await writeAuditReport(testInfo, findings);
    expect(formatFindings(findings)).toBe("# Playwright UI Audit\n\nNo findings.\n");
  });
});
