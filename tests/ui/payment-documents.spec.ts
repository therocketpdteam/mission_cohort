import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
let server: Server, origin: string, directory: string;
const initial = { id: "r1", totalAmount: 300, paymentStatus: "INVOICED", paymentMethod: "PURCHASE_ORDER", paymentRecords: [], purchaseOrderNumber: "PO-100" };

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mission-payment-ui-"));
  const root = process.cwd(), entry = path.join(directory, "entry.tsx");
  await writeFile(entry, `import React,{useState} from "react";import{createRoot}from"react-dom/client";import{RegistrationDocuments}from ${JSON.stringify(path.join(root, "src/components/admin/RegistrationDocuments"))};import{CollapsibleSectionCard}from ${JSON.stringify(path.join(root, "src/components/admin/CollapsibleSectionCard"))};import{registrationFinanceAlerts}from ${JSON.stringify(path.join(root, "src/lib/registrationFinanceAlerts"))};function Fixture(){const[row,setRow]=useState(${JSON.stringify(initial)});return <main style={{maxWidth:900,margin:"20px auto",padding:12,display:"grid",gap:12}}><RegistrationDocuments registration={row} onChanged={async()=>{const r=await fetch('/api/registrations?id=r1');setRow((await r.json()).data)}} onError={()=>{}}/><CollapsibleSectionCard title="Invoice" compact alertCount={registrationFinanceAlerts(row).invoice}><p>Invoice INV-100</p></CollapsibleSectionCard></main>}createRoot(document.getElementById('root')!).render(<Fixture/>);`);
  const taskRequire = createRequire(path.join(root, "package.json")), esbuild = createRequire(taskRequire.resolve("tsx"))("esbuild");
  await esbuild.build({ entryPoints: [entry], outfile: path.join(directory, "app.js"), bundle: true, jsx: "automatic", platform: "browser", format: "iife", nodePaths: [path.join(root, "node_modules")], tsconfig: path.join(root, "tsconfig.json"), define: { "process.env.NODE_ENV": '"test"' } });
  server = createServer(async (request, response) => {
    const file = request.url?.split("?")[0];
    if (file === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(path.join(directory, "app.js"))); }
    else if (file?.endsWith(".css")) { response.setHeader("Content-Type", "text/css"); response.end(await readFile(path.join(root, "src/app", file.slice(1)))); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/ui-foundation.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port"); origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });

async function api(page: Page) {
  let row: any = structuredClone(initial), sequence = 0;
  const mutations: any[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "GET") { await route.fulfill({ json: { success: true, data: row } }); return; }
    if (url.pathname === "/api/uploads") { await route.fulfill({ json: { success: true, data: { fileKey: `check-payment/proof-${++sequence}.pdf` } } }); return; }
    const body = request.postDataJSON(); mutations.push(body);
    if (body.type === "purchaseOrder") { row.purchaseOrderNumber = body.purchaseOrderNumber; row.purchaseOrderFileKey = body.fileKey; row.purchaseOrderFileName = body.fileName; }
    else if (!body.fileKey) { row.checkPaymentFileKey = null; row.checkPaymentFileName = null; }
    else {
      const payment = { id: body.checkPaymentRecordId ?? `p${row.paymentRecords.length + 1}`, amount: body.checkAmount, status: body.checkAmount >= 300 ? "PAID" : "PARTIALLY_PAID", method: "CHECK", notes: '[mission-cohort-check:v1]' + JSON.stringify({ checkNumber: body.checkNumber, fileKey: body.fileKey, fileName: body.fileName, contentType: body.contentType }) };
      row.paymentRecords = [...row.paymentRecords.filter((item: any) => item.id !== payment.id), payment];
      row.checkPaymentFileKey = body.fileKey; row.checkPaymentFileName = body.fileName;
      row.paymentStatus = row.paymentRecords.reduce((sum: number, item: any) => sum + item.amount, 0) >= 300 ? "PAID" : "PARTIALLY_PAID";
    }
    await route.fulfill({ json: { success: true, data: row } });
  });
  return { mutations, errors };
}
const file = { name: "check.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic proof") };

test("purchase order stays on one row in a reconciliation drawer, with its note underneath", async ({ page }, info) => {
  await api(page); await page.setViewportSize({ width: 510, height: 1000 }); await page.goto(origin); await page.getByText("Payment Documents", { exact: true }).click();
  const heading = await page.getByText("Purchase order", { exact: true }).boundingBox();
  const input = await page.getByLabel("PO number", { exact: true }).boundingBox();
  const button = await page.locator(".is-po .registration-payment-document-upload").boundingBox();
  expect(heading && input && button).toBeTruthy();
  expect(Math.abs(input!.y - button!.y)).toBeLessThan(30);
  expect(Math.abs(heading!.y - button!.y)).toBeLessThan(35);
  const note = await page.getByText("Upload stages the number for Apply Changes.", { exact: true }).boundingBox();
  expect(note!.y).toBeGreaterThan(input!.y + input!.height);
  await page.screenshot({ path: info.outputPath("payment-documents-drawer.png"), fullPage: true });
});

test("check amount and number validate before upload and reflect partial then full reconciliation", async ({ page }, info) => {
  const observed = await api(page); await page.goto(origin); await page.getByText("Payment Documents", { exact: true }).click();
  await page.getByLabel("Upload check payment proof", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("check amount"); expect(observed.mutations).toHaveLength(0);
  await page.getByLabel("Check amount ($)", { exact: true }).fill("100");
  await page.getByLabel("Check number", { exact: true }).fill("00123");
  await expect(page.getByText(/Partially paid after upload/)).toContainText("$200.00 remaining");
  await page.getByLabel("Upload check payment proof", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("status")).toContainText("partially paid");
  expect(observed.mutations[0].checkNumber).toBe("00123"); expect(observed.mutations[0].checkAmount).toBe(100);
  await page.getByRole("button", { name: "Record another check", exact: true }).click();
  await page.getByLabel("Check amount ($)", { exact: true }).fill("200");
  await page.getByLabel("Check number", { exact: true }).fill("00124");
  await expect(page.getByText(/Fully paid after upload/)).toContainText("$0.00 remaining");
  await page.getByLabel("Upload check payment proof", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("status")).toContainText("fully paid");
  await page.getByLabel("Check amount ($)", { exact: true }).fill("150");
  await expect(page.getByText(/Partially paid after upload/)).toContainText("$50.00 remaining");
  await page.getByLabel("Upload check payment proof", { exact: true }).setInputFiles(file);
  await expect.poll(() => observed.mutations.length).toBe(3);
  expect(observed.mutations[2].checkPaymentRecordId).toBe("p2"); expect(observed.errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("payment-documents-recorded.png"), fullPage: true });
});

test("narrow mobile panels remain usable without horizontal overflow", async ({ page }) => {
  await api(page); await page.setViewportSize({ width: 360, height: 1000 }); await page.goto(origin); await page.getByText("Payment Documents", { exact: true }).click();
  await expect(page.getByLabel("PO number", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Check amount ($)", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("compact finance cards start closed, retain warning icons and support keyboard opening", async ({ page }, info) => {
  await api(page); await page.goto(origin);
  const documents = page.locator("details").filter({ has: page.getByRole("heading", { name: "Payment Documents", exact: true }) });
  const invoice = page.locator("details").filter({ has: page.getByRole("heading", { name: "Invoice", exact: true }) });
  await expect(documents).not.toHaveAttribute("open"); await expect(invoice).not.toHaveAttribute("open");
  await expect(documents.locator(".collapsible-section-alert")).toBeVisible();
  await expect(invoice.locator(".collapsible-section-alert")).toBeVisible();
  expect((await documents.boundingBox())!.height).toBeLessThan(60);
  await invoice.locator("summary").focus(); await page.keyboard.press("Space");
  await expect(page.getByText("Invoice INV-100", { exact: true })).toBeVisible();
  await invoice.locator("summary").click();
  await expect(page.getByText("Invoice INV-100", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath("compact-finance-cards.png"), fullPage: true });
});

test("warnings clear when the recorded check pays the full registration", async ({ page }) => {
  await api(page); await page.goto(origin);
  const documents = page.locator("details").filter({ has: page.getByRole("heading", { name: "Payment Documents", exact: true }) });
  await documents.locator("summary").click();
  await page.getByLabel("Check amount ($)", { exact: true }).fill("300");
  await page.getByLabel("Check number", { exact: true }).fill("00130");
  await page.getByLabel("Upload check payment proof", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("status")).toContainText("fully paid");
  await expect(page.locator(".collapsible-section-alert")).toHaveCount(0);
});
