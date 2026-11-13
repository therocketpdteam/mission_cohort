import {test,expect,type Page} from "@playwright/test";
import {createServer,type Server} from "node:http";
import {createRequire} from "node:module";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";import os from "node:os";
import {financialSignature} from "../../src/lib/financialRosterReconciliation";
let server:Server,origin:string,directory:string;
const base={id:"r1",cohortId:"c1",totalAmount:10010,participantCount:1,paymentMethod:"INVOICE",paymentStatus:"PAID",status:"CONFIRMED",participantListStatus:"COMPLETE",primaryContactName:"QA Contact",primaryContactEmail:"poc@example.org",cohort:{id:"c1",title:"QA five-session cohort",pricePerParticipant:795,_count:{sessions:5}},organization:{id:"o1",name:"Sanitized QA district"},participants:[{id:"p1",firstName:"QA",lastName:"Participant",email:"person@example.org",status:"REGISTERED"}],invoiceDrafts:[],paymentRecords:[],pendingChanges:null,communications:[]};
const evidence={kind:"PRICING_2025",adjustmentCents:0,sourceReference:"Signed 2025 contract",reason:"Independently checked historical pricing, all adjustments and invoice revisions.",signature:financialSignature(base),reviewedAt:"2026-11-13",reviewedBy:"qa"};
test.beforeAll(async()=>{
 directory=await mkdtemp(path.join(os.tmpdir(),"finance-roster-ui-"));const root=process.cwd(),entry=path.join(directory,"entry.tsx");
 await writeFile(entry,`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{RegistrationDeliveryPreflight}from ${JSON.stringify(path.join(root,"src/components/admin/RegistrationDeliveryPreflight"))};import{RegistrationsClient}from ${JSON.stringify(path.join(root,"src/components/admin/RegistrationsClient"))};function Detail(){const[r,setR]=useState(window.fixture??${JSON.stringify(base)});return <main style={{maxWidth:1000,margin:'20px auto'}}><RegistrationDeliveryPreflight registration={r} onFinancialReview={async()=>{const response=await fetch('/api/registrations?id=r1');setR((await response.json()).data)}}/></main>}createRoot(document.getElementById('root')!).render(location.pathname==='/registrations'?<RegistrationsClient/>:<Detail/>);`);
 const req=createRequire(path.join(root,"package.json")),esbuild=createRequire(req.resolve("tsx"))("esbuild");
 await esbuild.build({entryPoints:[entry],outfile:path.join(directory,"app.js"),bundle:true,jsx:"automatic",platform:"browser",format:"iife",nodePaths:[path.join(root,"node_modules")],tsconfig:path.join(root,"tsconfig.json"),define:{"process.env.NODE_ENV":'"test"'}});
 server=createServer(async(request,response)=>{const file=request.url?.split('?')[0];if(file==='/app.js'){response.setHeader('Content-Type','text/javascript');response.end(await readFile(path.join(directory,'app.js')));}else if(file?.endsWith('.css')){response.setHeader('Content-Type','text/css');response.end(await readFile(path.join(root,'src/app',file.slice(1))));}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/ui-foundation.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const a=server.address();if(!a||typeof a==='string')throw Error('no port');origin=`http://127.0.0.1:${a.port}`;
});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});
async function setup(page:Page,verified=false){
 let current:any={...structuredClone(base),...(verified?{financialReview:evidence}:{})};const mutations:any[]=[];
 await page.addInitScript(row=>(window as any).fixture=row,current);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let data:any=[];
  if(request.method()!=='GET'){expect(url.pathname).toBe('/api/registrations/r1/financial-reconciliation');const body=request.postDataJSON();mutations.push(body);current={...current,financialReview:{...body,reviewedBy:'qa',reviewedAt:'2026-11-13'}};data={status:'MISSING_PARTICIPANTS'};}
  else if(url.pathname==='/api/registrations')data=url.searchParams.has('id')?current:[current];
  else if(url.pathname==='/api/cohorts')data=[base.cohort];else if(url.pathname==='/api/organizations')data=[base.organization];
  await route.fulfill({json:{success:true,data}});
 });return{mutations};
}
test('incorrect stored one-seat completion is visibly Needs Review with unverified 21-seat gap',async({page},info)=>{
 const f=await setup(page);await page.goto(origin);await expect(page.getByText('21 potentially missing',{exact:true})).toBeVisible();await expect(page.getByText('Saved recipients only',{exact:true})).toBeVisible();await expect(page.getByText('Not verified',{exact:true})).toBeVisible();expect(f.mutations).toHaveLength(0);await page.screenshot({path:info.outputPath('financial-roster-preflight.png'),fullPage:true});
});
test('verified missing seats stay distinct from saved-recipient delivery readiness',async({page})=>{
 await setup(page,true);await page.goto(origin);await expect(page.getByText('21 missing / 0 excess',{exact:true})).toBeVisible();await expect(page.getByText('Saved recipients only',{exact:true})).toBeVisible();await expect(page.getByText('22',{exact:true})).toBeVisible();
});
test('review requires source, explanation and confirmation; saves evidence only and refreshes status',async({page})=>{
 const f=await setup(page);await page.goto(origin);await page.getByRole('button',{name:'Review financial evidence',exact:true}).click();await expect(page.getByRole('button',{name:'Save reviewed evidence'})).toBeDisabled();
 await page.getByLabel('Verified purchased seats',{exact:true}).fill('22');await page.getByLabel('Evidence reference (contract, invoice and line, or pricing approval)',{exact:true}).fill('Signed verified contract, line 1');await page.getByLabel('Review explanation and resolution of adjustments/conflicts',{exact:true}).fill('Verified 22 contracted seats after reviewing all credits and invoice revisions.');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save reviewed evidence'}).click();await expect(page.getByText('21 missing / 0 excess',{exact:true})).toBeVisible();expect(f.mutations).toHaveLength(1);expect(f.mutations[0].quantity).toBe(22);expect(f.mutations[0].confirmed).toBe(true);
});
test('registration list exposes financial review counts and filters without changing payment status',async({page})=>{
 const f=await setup(page);await page.goto(origin+'/registrations');await expect(page.getByText('Sanitized Qa District',{exact:true})).toBeVisible();const filter=page.getByRole('button',{name:'Financial / roster',exact:true});await expect(filter).toBeVisible();await filter.click();await page.getByRole('button',{name:'Verified (0)',exact:true}).click();await expect(page.getByText('Sanitized Qa District',{exact:true})).toHaveCount(0);await filter.click();await page.getByRole('button',{name:'Needs Review (1)',exact:true}).click();await expect(page.getByText('Sanitized Qa District',{exact:true})).toBeVisible();expect(f.mutations).toHaveLength(0);
});
