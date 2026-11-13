import test from "node:test";
import assert from "node:assert/strict";
import { deliverScheduledPostSession, isScheduledPostSession } from "../../src/services/postSessionDeliveryService";

function fixture() {
  const row:any={id:"post1",sessionId:"s1",status:"SCHEDULED",sentAt:null,scheduledFor:new Date("2030-01-02T20:30:00Z"),template:{type:"FOLLOW_UP"}};
  const audit=new Map<string,any>(),events=new Map<string,any>(),attempts:string[]=[];
  let hook:(email:string)=>Promise<void>=async()=>{},historyFails=false;
  const client:any={cohortCommunication:{
    updateMany:async({where,data}:any)=>{if(where.id!==row.id || (where.status?.in ? !where.status.in.includes(row.status): where.status && where.status!==row.status) || (where.sentAt===null&&row.sentAt))return{count:0};Object.assign(row,data);return{count:1};},
    findUniqueOrThrow:async()=>({...row}),update:async({data}:any)=>Object.assign(row,data)
  },auditLog:{findUnique:async({where}:any)=>audit.get(where.id)??null,create:async({data}:any)=>{if(audit.has(data.id))throw Error("duplicate");audit.set(data.id,data);return data;},upsert:async({where,create,update}:any)=>{const saved=audit.has(where.id)?Object.assign(audit.get(where.id),update):create;audit.set(where.id,saved);return saved;},update:async({where,data}:any)=>{const saved=Object.assign(audit.get(where.id),data);return saved;}},emailEvent:{findMany:async({where}:any)=>[...events.values()].filter(event=>!where.communicationId||event.communicationId===where.communicationId),upsert:async({where,create}:any)=>{if(historyFails)throw Error("Tracking unavailable");if(!events.has(where.id))events.set(where.id,create);return events.get(where.id);}}};
  let prepares=0;
  const prepare=async()=>{prepares++;return{subject:"Follow-up",bodyHtml:"<p>Original recording link</p>",attachments:[],targets:[{email:"A@EXAMPLE.ORG",context:{name:"A"}},{email:"b@example.org",context:{name:"B"}}]};};
  const deps={client,prepare,validate:async()=>{},snapshot:(r:any)=>({renderedSubject:r.renderedSubject}),send:async(input:any,before:()=>Promise<void>)=>{await before();attempts.push(input.to);await hook(input.to);return{providerMessageId:"provider-"+input.to,renderedSubject:input.subject};}};
  return{row,audit,events,attempts,deps,setHook:(fn:typeof hook)=>hook=fn,setHistoryFailure:(value:boolean)=>historyFails=value,getPrepares:()=>prepares};
}

test("manual Send Now consumes the existing schedule and later scheduled delivery is idempotent",async()=>{
 const f=fixture(),schedule=f.row.scheduledFor;
 await deliverScheduledPostSession({...f.row},f.deps);
 assert.equal(f.row.status,"SENT");assert.ok(f.row.sentAt instanceof Date);assert.equal(f.row.scheduledFor,schedule);
 assert.deepEqual(f.attempts,["a@example.org","b@example.org"]);assert.equal(f.events.size,2);
 await deliverScheduledPostSession({...f.row},f.deps);assert.equal(f.attempts.length,2);assert.equal(f.getPrepares(),1);
});

test("manual and scheduler workers racing on a stale scheduled row deliver only once",async()=>{
 const f=fixture();let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);f.setHook(async()=>held);
 const stale={...f.row},first=deliverScheduledPostSession(stale,f.deps);
 await new Promise(resolve=>setTimeout(resolve,10));
 await assert.rejects(deliverScheduledPostSession(stale,f.deps),/already sending/);
 release();await first;assert.equal(f.attempts.length,2);
});

test("confirmed rejection retries only unsent recipients using the frozen envelope",async()=>{
 const f=fixture();f.setHook(async email=>{if(email==="b@example.org")throw Object.assign(Error("Rejected"),{deliveryUncertain:false});});
 await assert.rejects(deliverScheduledPostSession({...f.row},f.deps),/Rejected/);assert.equal(f.row.status,"FAILED");assert.equal(f.events.size,1);
 f.setHook(async()=>{});f.deps.prepare=async()=>{throw Error("Must reuse saved content/audience");};
 await deliverScheduledPostSession({...f.row},f.deps);assert.equal(f.row.status,"SENT");assert.deepEqual(f.attempts,["a@example.org","b@example.org","b@example.org"]);
});

test("ambiguous provider outcome is never blindly resent",async()=>{
 const f=fixture();f.setHook(async()=>{throw Object.assign(Error("Connection reset"),{deliveryUncertain:true});});
 await assert.rejects(deliverScheduledPostSession({...f.row},f.deps),/provider verification/);
 f.setHook(async()=>{});await assert.rejects(deliverScheduledPostSession({...f.row},f.deps),/provider verification/);
 assert.equal(f.attempts.filter(email=>email==="a@example.org").length,1);assert.equal(f.row.status,"FAILED");
});

test("a tracking failure after provider acceptance is repaired without sending again",async()=>{
 const f=fixture();f.setHistoryFailure(true);await assert.rejects(deliverScheduledPostSession({...f.row},f.deps));
 assert.deepEqual(f.attempts,["a@example.org"]);
 f.setHistoryFailure(false);await deliverScheduledPostSession({...f.row},f.deps);
 assert.deepEqual(f.attempts,["a@example.org","b@example.org"]);assert.equal(f.events.size,2);assert.equal(f.row.status,"SENT");
});

test("a pre-provider validation failure leaves a safe retry and other email types stay out of scope",async()=>{
 const f=fixture();f.deps.validate=async()=>{throw Error("Outbound locked");};await assert.rejects(deliverScheduledPostSession({...f.row},f.deps),/Outbound locked/);
 assert.equal(f.attempts.length,0);assert.equal(f.row.status,"FAILED");assert.equal(f.row.sentAt,null);
 assert.equal(isScheduledPostSession(f.row),true);assert.equal(isScheduledPostSession({...f.row,template:{type:"PAYMENT_REMINDER"}}),false);assert.equal(isScheduledPostSession({...f.row,scheduledFor:null}),false);
});

import { prisma } from "../../src/lib/prisma";
import { encryptSecret } from "../../src/lib/integrationCrypto";
import { sendWithSendGrid } from "../../src/modules/email/sendgridProvider";

test("provider boundary checkpoints before POST and distinguishes rejection from uncertain transport",async()=>{
 const originalFetch=globalThis.fetch, originalConnection=prisma.integrationConnection.findUnique;
 prisma.integrationConnection.findUnique=(async()=>({accessToken:encryptSecret("SG.synthetic.test"),metadata:{fromEmail:"sender@example.org"}})) as any;
 const input={to:"a@example.org",subject:"Post session",html:"<p>Recording</p>"};
 try {
  const order:string[]=[];
  globalThis.fetch=(async()=>{order.push("provider-post");return new Response(null,{status:202,headers:{"x-message-id":"accepted"}});}) as typeof fetch;
  const result=await sendWithSendGrid(input,{beforeRequest:async()=>{order.push("durable-checkpoint");}});
  assert.deepEqual(order,["durable-checkpoint","provider-post"]);assert.equal(result.providerMessageId,"accepted");
  globalThis.fetch=(async()=>new Response("rejected",{status:400})) as typeof fetch;
  await assert.rejects(sendWithSendGrid(input,{beforeRequest:async()=>{}}),(error:any)=>error.deliveryUncertain===false);
  globalThis.fetch=(async()=>{throw Error("Connection reset");}) as typeof fetch;
  await assert.rejects(sendWithSendGrid(input,{beforeRequest:async()=>{}}),(error:any)=>error.deliveryUncertain===true);
  let posted=false;globalThis.fetch=(async()=>{posted=true;return new Response(null,{status:202});}) as typeof fetch;
  await assert.rejects(sendWithSendGrid(input,{beforeRequest:async()=>{throw Error("Checkpoint unavailable");}}),/Checkpoint unavailable/);assert.equal(posted,false);
 }finally{globalThis.fetch=originalFetch;prisma.integrationConnection.findUnique=originalConnection;}
});

import { processScheduledCommunications, sendScheduledPostSessionNow } from "../../src/services/communicationService";
import { env } from "../../src/lib/env";

test("real manual and automatic entry points reuse the same scheduled row and delivery infrastructure",async()=>{
 const f=fixture();Object.assign(f.row,{scheduledFor:new Date("2020-01-01T12:00:00Z"),cohortId:"c1",subject:"Session recording",bodyHtml:"<a href='{{session.recordingUrl}}'>Recording</a>",bodyText:"Recording",cohort:{id:"c1",title:"Example",status:"PUBLISHED"},session:{id:"s1",title:"Session",recordingUrl:"https://example.org/recording"},registration:null,participant:null,templateId:"t1",recipientScope:"CUSTOM",recipientEmails:["a@example.org"],attachments:[],journeyKey:null});
 const methods:Array<[any,string,any]>=[
  [prisma.cohortCommunication,"findUnique",async()=>({...f.row})],
  [prisma.cohortCommunication,"findUniqueOrThrow",f.deps.client.cohortCommunication.findUniqueOrThrow],
  [prisma.cohortCommunication,"updateMany",f.deps.client.cohortCommunication.updateMany],
  [prisma.cohortCommunication,"update",f.deps.client.cohortCommunication.update],
  [prisma.cohortCommunication,"findMany",async()=>f.row.status==="SCHEDULED"?[{...f.row}]:[]],
  [prisma.cohortCommunication,"findFirst",async()=>null],
  [prisma.operationsTask,"findUnique",async()=>null],
  [prisma.cohort,"findUnique",async()=>({registrations:[],participants:[]})],
  [prisma.integrationConnection,"findUnique",async()=>({accessToken:encryptSecret("SG.synthetic.test"),metadata:{fromEmail:"sender@example.org",testRecipientEmails:["a@example.org"],liveSendingEnabled:false}})],
  ...["findUnique","create","upsert","update"].map(key=>[prisma.auditLog,key,f.deps.client.auditLog[key]] as [any,string,any]),
  ...["findMany","upsert"].map(key=>[prisma.emailEvent,key,f.deps.client.emailEvent[key]] as [any,string,any])
 ];
 const originals=methods.map(([object,key])=>object[key]),oldLock=env.OUTBOUND_RELEASE_LOCK,oldFetch=globalThis.fetch;let posts=0;
 methods.forEach(([object,key,value])=>object[key]=value);env.OUTBOUND_RELEASE_LOCK="unlocked";
 globalThis.fetch=(async(url:any,options:any)=>{assert.equal(String(url),"https://api.sendgrid.com/v3/mail/send");assert.equal(options.method,"POST");const payload=JSON.parse(options.body);assert.ok(payload.content.some((part:any)=>part.value.includes("https://example.org/recording")));posts++;return new Response(null,{status:202,headers:{"x-message-id":"provider-accepted"}});}) as typeof fetch;
 try {
  const originalSchedule=f.row.scheduledFor;
  await sendScheduledPostSessionNow(f.row.id);assert.equal(f.row.status,"SENT");assert.equal(posts,1);assert.equal(f.row.scheduledFor,originalSchedule);
  await processScheduledCommunications();assert.equal(posts,1);
  await sendScheduledPostSessionNow(f.row.id);assert.equal(posts,1);
  // A separate untouched scheduled record still uses the automatic path.
  f.row.id="post2";f.row.status="SCHEDULED";f.row.sentAt=null;await processScheduledCommunications();assert.equal(posts,2);assert.equal(f.row.status,"SENT");
 }finally{methods.forEach(([object,key],index)=>object[key]=originals[index]);env.OUTBOUND_RELEASE_LOCK=oldLock;globalThis.fetch=oldFetch;}
});
