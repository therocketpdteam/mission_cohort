import {test,expect,type Page} from "@playwright/test";
import {createServer,type Server} from "node:http";
import {createRequire} from "node:module";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
let server:Server,origin:string,directory:string;
const row={id:"post1",sessionId:"s1",cohortId:"c1",cohort:{id:"c1",title:"Example cohort"},session:{title:"Session one",timezone:"America/New_York",recordingUrl:"https://example.org/recording"},template:{type:"FOLLOW_UP",name:"24 Hours Post Session"},subject:"Your recording is ready",bodyHtml:"<p>Recording is ready</p>",bodyText:"Recording is ready",status:"SCHEDULED",recipientScope:"ALL_PARTICIPANTS",scheduledFor:"2030-01-02T20:30:00Z",sentAt:null,recipientRows:[],attachments:[]};
test.beforeAll(async()=>{
 directory=await mkdtemp(path.join(os.tmpdir(),"post-session-ui-"));const root=process.cwd(),entry=path.join(directory,"entry.tsx");
 await writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{CommunicationsClient}from ${JSON.stringify(path.join(root,"src/components/admin/CommunicationsClient"))};createRoot(document.getElementById('root')!).render(<CommunicationsClient/>);`);
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
async function setup(page:Page,fail=false){
 let current:any=structuredClone(row);const mutations:any[]=[];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let data:any=[];
  if(request.method()!=='GET'){
   const body=request.postDataJSON();mutations.push(body);
   if(fail){current.status='FAILED';await route.fulfill({status:400,json:{success:false,error:{message:'Provider temporarily rejected the send. Retry unsent recipients.',code:'BAD_REQUEST'}}});return;}
   current={...current,status:'SENT',sentAt:'2026-11-13T16:30:00Z'};data=current;
  }else if(url.pathname==='/api/communications')data=[current];
  else if(url.pathname==='/api/cohorts')data=[row.cohort];
  else if(url.pathname==='/api/system-health')data={groups:[]};
  await route.fulfill({json:{success:true,data}});
 });return{mutations,set:(value:any)=>current=value};
}
test('Send Now requires confirmation, sends the existing ID once, then removes scheduled action',async({page},info)=>{
 const f=await setup(page);await page.goto(origin);
 const send=page.getByRole('button',{name:'Send Now',exact:true});await expect(send).toBeVisible();await send.click();
 await expect(page.getByText('Send post-session email now?',{exact:true})).toBeVisible();expect(f.mutations).toHaveLength(0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(f.mutations).toHaveLength(0);
 await send.click();await page.screenshot({path:info.outputPath('send-now-confirmation.png'),fullPage:true});
 await page.getByRole('button',{name:'Confirm Send Now',exact:true}).click();
 await expect(send).toHaveCount(0);expect(f.mutations).toEqual([{action:'sendPostSessionNow',id:'post1'}]);await expect(page.getByRole('table').getByText('Sent',{exact:true})).toBeVisible();
});
test('failed send keeps a visible retry with no new draft or schedule mutation',async({page})=>{
 const f=await setup(page,true);await page.goto(origin);await page.getByRole('button',{name:'Send Now',exact:true}).click();await page.getByRole('button',{name:'Confirm Send Now',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Retry unsent recipients');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Retry unsent',exact:true})).toBeVisible();expect(f.mutations).toHaveLength(1);
});
test('other scheduled workflows do not gain the post-session Send Now button',async({page})=>{
 const f=await setup(page);f.set({...row,template:{type:'DAY_BEFORE_REMINDER',name:'24 Hours Before Session'}});await page.goto(origin);await expect(page.getByText('Your recording is ready',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send Now',exact:true})).toHaveCount(0);
});
