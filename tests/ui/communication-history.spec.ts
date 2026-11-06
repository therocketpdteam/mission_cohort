import { test, expect, type Page, type Route } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mount the real client components against mocked read-only APIs. No app login,
// production database, credentials, or email provider is involved.
let server: Server, origin: string, directory: string;
const email = "lauryn@example.org";
const cohort = { id: "c1", title: "Building Thinking Classrooms", shortName: "PL Fall", status: "ACTIVE" };
const row = { id: "message1", cohortId: "c1", cohort, subject: "Welcome Lauryn", status: "SENT", recipientEmail: email, recipientScope: "ALL_PARTICIPANTS", sentAt: "2026-11-05T22:30:00Z", createdAt: "2026-09-08T12:00:00Z", scheduledFor: null, issueCount: 0, session: { title: "Engagement in the Thinking Classroom" } };
const content = (name: string) => ({ provenance: "snapshot", subject: `Welcome ${name}`, bodyHtml: `<p>Hi ${name}, saved original content.</p><img src="https://tracker.invalid/pixel"><script>fetch('https://tracker.invalid/script')</script>`, bodyText: `Hi ${name}`, warnings: [], attachments: [] });
const pageData = (rows = [row], total = 178, nextCursor: string | null = "older") => ({ rows, total, nextCursor, summary: { sent: total, scheduled: 1, issues: 0 }, recipient: email });

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mission-history-ui-"));
  const root = process.cwd();
  const entry = path.join(directory, "entry.tsx");
  await writeFile(entry, `import React from "react";import {createRoot} from "react-dom/client";import {CommunicationsClient} from ${JSON.stringify(path.join(root,"src/components/admin/CommunicationsClient"))};import {ParticipantsClient} from ${JSON.stringify(path.join(root,"src/components/admin/ParticipantsClient"))};createRoot(document.getElementById("root")!).render(location.pathname==="/participants"?<ParticipantsClient/>:<CommunicationsClient/>);`);
  const taskRequire = createRequire(path.join(root,"package.json"));
  const esbuild = createRequire(taskRequire.resolve("tsx"))("esbuild");
  await esbuild.build({ entryPoints:[entry], outfile:path.join(directory,"app.js"), bundle:true, jsx:"automatic", platform:"browser", format:"iife", nodePaths:[path.join(root,"node_modules")], tsconfig:path.join(root,"tsconfig.json"), define:{"process.env.NODE_ENV":'"test"'} });
  server = createServer(async (request,response) => {
    try {
      const file = request.url?.split("?")[0];
      if (file === "/app.js") { response.setHeader("Content-Type","text/javascript"); response.end(await readFile(path.join(directory,"app.js"))); }
      else if (file === "/globals.css" || file === "/ui-foundation.css") {response.setHeader("Content-Type","text/css");response.end(await readFile(path.join(root,"src/app",file.slice(1))));}
      else {response.setHeader("Content-Type","text/html");response.end('<!doctype html><html><head><link rel="stylesheet" href="/globals.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');}
    } catch {response.statusCode=500;response.end("fixture error");}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address==="string")throw new Error("No fixture port");
  origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(directory)await rm(directory,{recursive:true,force:true});});

async function intercept(page: Page, handler?: (url: URL,route: Route)=>Promise<boolean>) {
  const mutations: string[]=[];
  const errors: string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=="GET"){mutations.push(url.pathname);await route.abort();return;}
    if(handler && await handler(url,route))return;
    let data: any=[];
    if(url.pathname==="/api/cohorts")data=[cohort];
    if(url.pathname==="/api/system-health")data={groups:[]};
    if(url.pathname==="/api/communications" && url.searchParams.has("history"))data=pageData([{...row,recipientEmail:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.searchParams.get("search")??"")?email:null as any}]);
    if(url.pathname==="/api/communications" && url.searchParams.has("id")){
      const recipient=url.searchParams.get("recipient");
      const selected=recipient==="alex@example.org"?"Alex":"Lauryn";
      data={...row,recipientEmail:recipient,subject:`Welcome ${selected}`,recipients:[email,"alex@example.org"],recipientRows:[],attachments:[],content:recipient?content(selected):null,
        attempts:recipient?[{id:"latest",sentAt:row.sentAt,content:content(selected)},{id:"earlier",sentAt:"2026-10-29T22:30:00Z",content:{...content(selected),bodyHtml:`<p>Hi ${selected}, earlier send.</p>`}}]:[]};
    }
    await route.fulfill({json:{success:true,data}});
  });
  return {mutations,errors};
}

test("email search uses the server, defaults to Sent, pages older results, and previews exact attempts safely",async({page},info)=>{
  const requests: URL[]=[];let tracking=0;
  await page.route("https://tracker.invalid/**",route=>{tracking++;return route.abort();});
  const observed=await intercept(page,async(url,route)=>{
    if(url.pathname==="/api/communications" && url.searchParams.has("history")){
      requests.push(url);
      await route.fulfill({json:{success:true,data:url.searchParams.get("cursor")?pageData([{...row,id:"older",subject:"Older Lauryn message"}],178,null):pageData()}});return true;
    }return false;
  });
  await page.goto(origin+"/communications");
  await page.getByLabel("Search messages",{exact:true}).fill(` ${email.toUpperCase()} `);
  await expect(page.getByRole("cell",{name:"Welcome Lauryn",exact:false}).first()).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("status")).toBe("SENT");
  await expect(page.getByRole("columnheader",{name:"Delivery",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Merge Fields",exact:true})).toHaveCount(0);
  await expect(page.getByText("Not scheduled",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await expect(page.getByText("Older Lauryn message",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Previous",exact:true}).click();
  await expect(page.getByText("Welcome Lauryn",{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("history-workspace.png"),fullPage:true});
  await page.getByText("Welcome Lauryn",{exact:true}).click();
  await expect(page.getByText("Saved sent copy",{exact:true})).toBeVisible();
  await expect(page.frameLocator('iframe[title^="Email sent to"]').getByText("Hi Lauryn, saved original content.")).toBeVisible();
  await page.getByRole("button",{name:"Send attempt",exact:true}).click();
  await page.locator(".ui-select-option").filter({hasText:"Oct 29, 2026"}).click();
  await expect(page.frameLocator('iframe[title^="Email sent to"]').getByText("Hi Lauryn, earlier send.")).toBeVisible();
  expect(tracking).toBe(0);expect(observed.mutations).toEqual([]);expect(observed.errors).toEqual([]);
  await page.screenshot({path:info.outputPath("recipient-history.png"),fullPage:true});
});

test("participant link shares search defaults and group messages require an explicit recipient",async({page})=>{
  const observed=await intercept(page);
  await page.goto(origin+`/communications?search=${email}`);
  await expect(page.getByRole("button",{name:"Status",exact:true})).toHaveText(/Sent/);
  const searched=page.waitForResponse(response=>new URL(response.url()).searchParams.get("search")==="Thinking");
  await page.getByLabel("Search messages",{exact:true}).fill("Thinking");
  await searched;
  await expect(page.getByText("Welcome Lauryn",{exact:true})).toBeVisible();
  await page.getByText("Welcome Lauryn",{exact:true}).click();
  await expect(page.getByText("Choose a recipient to view their personalized email.",{exact:false})).toBeVisible();
  await expect(page.locator('iframe[title^="Email sent to"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Recipient",exact:true}).click();
  await page.getByRole("button",{name:"alex@example.org",exact:true}).click();
  await expect(page.frameLocator('iframe[title^="Email sent to"]').getByText("Hi Alex, saved original content.")).toBeVisible();
  expect(observed.mutations).toEqual([]);expect(observed.errors).toEqual([]);
});

test("late search responses cannot replace a newer result",async({page})=>{
  let release!:()=>void,started=false;
  const held=new Promise<void>(resolve=>release=resolve);
  await intercept(page,async(url,route)=>{
    if(url.pathname!=="/api/communications" || !url.searchParams.has("history"))return false;
    const search=url.searchParams.get("search");
    if(search==="old@example.org"){started=true;await held;await route.fulfill({json:{success:true,data:pageData([{...row,subject:"Stale old result"}])}});}
    else await route.fulfill({json:{success:true,data:pageData([{...row,subject:search==="new@example.org"?"Current new result":"Initial result"}])}});
    return true;
  });
  await page.goto(origin+"/communications");
  await page.getByLabel("Search messages",{exact:true}).fill("old@example.org");
  await expect.poll(()=>started).toBe(true);
  await page.getByLabel("Search messages",{exact:true}).fill("new@example.org");
  await expect(page.getByText("Current new result",{exact:true})).toBeVisible();
  const response=page.waitForResponse(r=>r.url().includes("old%40example.org"));release();await response;
  await expect(page.getByText("Current new result",{exact:true})).toBeVisible();
  await expect(page.getByText("Stale old result",{exact:true})).toHaveCount(0);
});

test("status and cohort filters survive URL restore and failed searches are distinguished from no results",async({page})=>{
  const requests: URL[]=[];let fail=false;
  await intercept(page,async(url,route)=>{
    if(url.pathname!=="/api/communications" || !url.searchParams.has("history"))return false;
    requests.push(url);
    await route.fulfill(fail?{status:500,json:{success:false,error:{message:"Temporary test error",code:"TEST"}}}:{json:{success:true,data:pageData()}});
    return true;
  });
  await page.goto(origin+`/communications?search=${email}`);
  await expect(page.getByRole("button",{name:"Status",exact:true})).toHaveText(/Sent/);
  await page.getByRole("button",{name:"Status",exact:true}).click();
  await page.getByRole("button",{name:"All activity",exact:true}).click();
  await expect.poll(()=>requests.at(-1)?.searchParams.get("status")).toBe("");
  await page.getByRole("button",{name:"Cohort",exact:true}).click();
  await page.getByRole("button",{name:"PL-Fall",exact:true}).click();
  await expect.poll(()=>requests.at(-1)?.searchParams.get("cohortId")).toBe("c1");
  expect(new URL(page.url()).searchParams.get("status")).toBe("");
  fail=true;
  await page.evaluate(()=>{window.history.pushState({},"","/communications?search=alex%40example.org&status=FAILED");window.dispatchEvent(new PopStateEvent("popstate"));});
  await expect(page.getByRole("button",{name:"Status",exact:true})).toHaveText(/Failed/);
  await expect(page.getByText("Could not load communication history:",{exact:false})).toBeVisible();
  await expect(page.getByText("No matching messages",{exact:true})).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"Retry search",exact:true}).click();
  await expect(page.getByText("Welcome Lauryn",{exact:true})).toBeVisible();
});

test("Participants rows appear before slower supporting requests finish",async({page})=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  const observed=await intercept(page,async(url,route)=>{
    if(url.pathname==="/api/participants"){
      await route.fulfill({json:{success:true,data:[{id:"p1",firstName:"Lauryn",lastName:"Meisenzahl",email,registrationId:"r1",cohortId:"c1",organizationId:"o1",status:"REGISTERED",cohort,organization:{id:"o1",name:"Sevier Schools"},registration:{id:"r1",primaryContactName:"Lauryn",primaryContactEmail:email,paymentRecords:[]},emailSummary:{sentCount:9}}]}});return true;
    }
    if(["/api/registrations","/api/cohorts","/api/communications/templates"].includes(url.pathname)){
      await held;await route.fulfill({json:{success:true,data:[]}});return true;
    }return false;
  });
  await page.goto(origin+"/participants");
  await expect(page.getByText(email,{exact:true}).first()).toBeVisible();
  release();expect(observed.mutations).toEqual([]);expect(observed.errors).toEqual([]);
});
