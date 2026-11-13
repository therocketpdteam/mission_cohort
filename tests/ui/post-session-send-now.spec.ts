import {test,expect,type Page} from "@playwright/test";
import {createServer,type Server} from "node:http";
import {createRequire} from "node:module";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
let server:Server,origin:string,directory:string;
const session={id:"s1",title:"Session one",startTime:new Date(Date.now()-7200000).toISOString(),endTime:new Date(Date.now()-3600000).toISOString(),timezone:"America/New_York",recordingUrl:"https://example.org/recording"};
const row={id:"post1",sessionId:"s1",status:"SCHEDULED",scheduledFor:new Date(Date.now()+3600000).toISOString(),sentAt:null,recipientCount:7,eligible:true};
test.beforeAll(async()=>{
 directory=await mkdtemp(path.join(os.tmpdir(),"post-session-ui-"));const root=process.cwd(),entry=path.join(directory,"entry.tsx");
 await writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{SessionPostSessionEmail,useSessionPostSessionEmails}from ${JSON.stringify(path.join(root,"src/components/admin/SessionPostSessionEmail"))};function App(){const h=useSessionPostSessionEmails('c1');const s=window.testSession??${JSON.stringify(session)};return <main><h1>Example cohort</h1><h2>Sessions</h2><section><h3>{s.title}</h3><SessionPostSessionEmail cohortId="c1" cohortTitle="Example cohort" session={s} message={h.messages[0]} now={h.now} refresh={h.refresh}/></section></main>};createRoot(document.getElementById('root')!).render(<App/>);`);
 const req=createRequire(path.join(root,"package.json")),esbuild=createRequire(req.resolve("tsx"))("esbuild");
 await esbuild.build({entryPoints:[entry],outfile:path.join(directory,"app.js"),bundle:true,jsx:"automatic",platform:"browser",format:"iife",nodePaths:[path.join(root,"node_modules")],tsconfig:path.join(root,"tsconfig.json"),define:{"process.env.NODE_ENV":'"test"'}});
 server=createServer(async(request,response)=>{
  const file=request.url?.split('?')[0];
  if(file==='/app.js'){response.setHeader('Content-Type','text/javascript');response.end(await readFile(path.join(directory,'app.js')));}
  else if(file?.endsWith('.css')){response.setHeader('Content-Type','text/css');response.end(await readFile(path.join(root,'src/app',file.slice(1))));}
  else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/ui-foundation.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');}
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no port');origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});
async function setup(page:Page,options:{fail?:boolean;message?:any;session?:any}={}){
 let current:any={...structuredClone(row),...options.message};const mutations:any[]=[];
 if(options.session)await page.addInitScript(value=>(window as any).testSession=value,{...session,...options.session});
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.method()!=='GET'){
   const body=request.postDataJSON();mutations.push(body);
   if(options.fail){current.status='FAILED';current.providerError='Provider rejected delivery. Retry skips confirmed recipients.';await route.fulfill({status:400,json:{success:false,error:{message:current.providerError,code:'BAD_REQUEST'}}});return;}
   current={...current,status:'SENT',sentAt:new Date().toISOString(),eligible:false};
   await route.fulfill({json:{success:true,data:current}});return;
  }
  await route.fulfill({json:{success:true,data:[current]}});
 });return{mutations,set:(value:any)=>current={...current,...value}};
}
test('session action confirms cohort, date, type and recipients; sends exact existing message then shows Sent',async({page},info)=>{
 const f=await setup(page);await page.goto(origin);
 const send=page.getByRole('button',{name:'Send Post-Session Email Now',exact:true});await send.click();
 await expect(page.getByRole('dialog')).toContainText('Example cohort');
 await expect(page.getByRole('dialog')).toContainText('Session one');
 await expect(page.getByRole('dialog')).toContainText('24 Hours Post Session');
 await expect(page.getByRole('dialog')).toContainText('Recipients: 7');expect(f.mutations).toHaveLength(0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(f.mutations).toHaveLength(0);
 await send.click();await page.screenshot({path:info.outputPath('session-send-now-confirmation.png'),fullPage:true});
 await page.getByRole('button',{name:'Confirm Send Now',exact:true}).click();
 await expect(send).toHaveCount(0);expect(f.mutations).toEqual([{action:'sendPostSessionNow',id:'post1',cohortId:'c1',sessionId:'s1'}]);await expect(page.getByText(/Post-session email · Sent/)).toBeVisible();
});
test('failure preserves visible safe retry and provider error',async({page})=>{
 const f=await setup(page,{fail:true});await page.goto(origin);await page.getByRole('button',{name:'Send Post-Session Email Now',exact:true}).click();await page.getByRole('button',{name:'Confirm Send Now',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Retry skips confirmed');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Retry Unsent Post-Session Email',exact:true})).toBeVisible();expect(f.mutations).toHaveLength(1);
});
for(const [name,sessionChange,messageChange] of [
 ['future',{startTime:new Date(Date.now()+3600000).toISOString(),endTime:new Date(Date.now()+7200000).toISOString()},{}],
 ['ongoing',{startTime:new Date(Date.now()-3600000).toISOString(),endTime:new Date(Date.now()+3600000).toISOString()},{}],
 ['expired',{}, {scheduledFor:new Date(Date.now()-1000).toISOString(),eligible:false}],
 ['missing recording',{recordingUrl:null},{}]
] as const)test(`${name} session has no send action`,async({page})=>{
 await setup(page,{session:sessionChange,message:messageChange});await page.goto(origin);await expect(page.getByText('Session one',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send Post-Session Email Now',exact:true})).toHaveCount(0);
 if(name==='missing recording')await expect(page.getByText(/Add a valid recording link/)).toBeVisible();
});
test('scheduler completion refresh replaces action with actual Sent timestamp',async({page})=>{
 const f=await setup(page);await page.goto(origin);await expect(page.getByRole('button',{name:'Send Post-Session Email Now',exact:true})).toBeVisible();
 f.set({status:'SENT',sentAt:new Date().toISOString(),eligible:false});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Send Post-Session Email Now',exact:true})).toHaveCount(0);await expect(page.getByText(/Post-session email · Sent.*America\/New_York/)).toBeVisible();expect(f.mutations).toHaveLength(0);
});
