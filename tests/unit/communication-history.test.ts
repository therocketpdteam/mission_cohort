import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { prisma } from "../../src/lib/prisma";
import { emailSearchRecipient, historyTiming, isolatedEmailDocument, sentHistoryAttempts } from "../../src/lib/communicationHistory";
import { displayHistorySubject, findRecipientCommunicationIds, getCommunicationHistoryDetail, historyQuery, listCommunicationHistory, reconstructHistoryContent } from "../../src/services/communicationHistoryService";
import { getRecipientCommunicationSummary, getRecipientCommunicationThread } from "../../src/services/communicationService";
import { GET } from "../../src/app/api/communications/route";

const email = "lauryn@example.org";
const db = new PGlite();
const originalQuery = prisma.$queryRaw;
const originalEventFind = prisma.emailEvent.findMany;
test.before(async () => {
  await db.exec(`
    CREATE TABLE "Cohort" (id text PRIMARY KEY,title text,"shortName" text,"defaultTimezone" text);
    CREATE TABLE "CohortSession" (id text PRIMARY KEY,title text,timezone text);
    CREATE TABLE "CommunicationTemplate" (id text PRIMARY KEY,name text,type text);
    CREATE TABLE "CohortCommunication" (id text PRIMARY KEY,"cohortId" text,"sessionId" text,"templateId" text,"recipientScope" text,"recipientEmails" jsonb,subject text,status text,"createdAt" timestamp(3),"updatedAt" timestamp(3),"scheduledFor" timestamp(3),"sentAt" timestamp(3));
    CREATE TABLE "EmailEvent" (id text PRIMARY KEY,"communicationId" text,"recipientEmail" text,"eventType" text,"eventPayload" jsonb,"createdAt" timestamp(3),"reviewedAt" timestamp(3));
    INSERT INTO "Cohort" VALUES ('c1','Building Thinking Classrooms','PL Fall','America/New_York'),('c2','Kim Marshall','KM Fall','America/New_York');
    INSERT INTO "CohortSession" VALUES ('s1','Engagement in the Thinking Classroom','America/New_York');
    INSERT INTO "CommunicationTemplate" VALUES ('t1','Participant confirmation','REGISTRATION_CONFIRMATION');
    INSERT INTO "CohortCommunication"
    SELECT 'm'||lpad(n::text,4,'0'),'c1','s1','t1','CUSTOM','["LAURYN@EXAMPLE.ORG"]'::jsonb,'Hi {{participant.firstName}}: {{cohort.title}}','SENT','2026-09-01'::timestamp,'2026-11-06'::timestamp,NULL,'2026-10-01'::timestamp + n*interval '1 hour' FROM generate_series(1,176) n;
    INSERT INTO "EmailEvent"
    SELECT 'e'||n,'m'||lpad(n::text,4,'0'),'${email}','SENT',jsonb_build_object('renderedSubject','Hi Lauryn '||n,'renderedBodyHtml','<p>Saved historical content '||n||'</p>'),'2026-10-01'::timestamp+n*interval '1 hour',NULL FROM generate_series(1,176) n;
    INSERT INTO "CohortCommunication" VALUES
      ('partial','c1','s1','t1','ALL_PARTICIPANTS',NULL,'Reminder: {{cohort.title}}','FAILED','2026-11-05','2026-11-05',NULL,NULL),
      ('legacy','c2',NULL,'t1','CUSTOM','[" LAURYN@EXAMPLE.ORG "]','Registered: {{cohort.title}}','SENT','2026-09-08','2026-09-08',NULL,'2026-09-08'),
      ('future','c1','s1','t1','CUSTOM','["${email}"]','Reminder','SCHEDULED','2026-11-06','2026-11-06','2026-11-20',NULL),
      ('unrelated','c2',NULL,'t1','CUSTOM','["other@example.org"]','${email}','SENT','2026-11-06','2026-11-06',NULL,'2026-11-06');
    INSERT INTO "EmailEvent" VALUES
      ('partial-send','partial','${email}','SENT','{"renderedSubject":"Reminder for Lauryn"}','2026-11-05 22:30',NULL),
      ('partial-fail','partial','alex@example.org','FAILED','{}','2026-11-05 22:31',NULL);
    ALTER TABLE "EmailEvent" ADD COLUMN "providerMessageId" text;
  `);
  prisma.$queryRaw = (async (query: any) => (await db.query(query.text, query.values.map((v: any) => v instanceof Date ? v.toISOString() : v))).rows) as any;
  prisma.emailEvent.findMany = (async ({where}: any) => {
    const rows = (await db.query<any>('SELECT id,"communicationId","recipientEmail","eventType","createdAt","reviewedAt" FROM "EmailEvent"')).rows;
    return rows.filter(row=>(typeof where.communicationId === "string" ? row.communicationId===where.communicationId : where.communicationId.in.includes(row.communicationId)) && (!where.recipientEmail || row.recipientEmail.toLowerCase()===where.recipientEmail.equals));
  }) as any;
});


test.after(async () => { prisma.$queryRaw = originalQuery; prisma.emailEvent.findMany=originalEventFind; await db.close(); });

test("direct and URL email searches normalize identically and paginate beyond 150 without bodies", async () => {
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await listCommunicationHistory({ search: ` ${email.toUpperCase()} `,status:"SENT",cursor,limit:25 });
    assert.equal(page.total,178);
    assert.equal(page.recipient,email);
    assert.equal(JSON.stringify(page).includes("Saved historical content"),false);
    assert.ok(page.rows.every(row=>row.status==="SENT" && row.subject.indexOf("{{")<0));
    assert.ok(page.rows.every(row=>/[Z+]/.test(row.sentAt)));
    ids.push(...page.rows.map(row=>row.id)); cursor=page.nextCursor;
  } while(cursor);
  assert.equal(ids.length,178);
  assert.equal(new Set(ids).size,178);
  const linked = await GET(new Request(`https://local.invalid/api/communications?history=1&search=${email}&limit=25`));
  const direct = await GET(new Request(`https://local.invalid/api/communications?history=1&search=${encodeURIComponent(` ${email.toUpperCase()} `)}&limit=25`));
  assert.deepEqual((await linked.json()).data,(await direct.json()).data);
  assert.equal(ids[0],"partial");
});

test("recipient evidence includes old explicit lists, excludes subject-only matches, and scopes partial sends", async () => {
  const ids=await findRecipientCommunicationIds(email.toUpperCase());
  assert.ok(ids.includes("legacy")); assert.ok(ids.includes("partial")); assert.ok(!ids.includes("unrelated"));
  const alex=await listCommunicationHistory({search:"alex@example.org",status:"FAILED"});
  assert.equal(alex.total,1); assert.equal(alex.rows[0].issueCount,1); assert.equal(alex.rows[0].sentAt,null);
  const lauryn=await listCommunicationHistory({search:email,status:"SENT",cohortId:"c1"});
  assert.equal(lauryn.rows[0].id,"partial");assert.equal(lauryn.rows[0].issueCount,0);
  assert.equal(lauryn.rows[0].subject,"Reminder for Lauryn");
  const all=await listCommunicationHistory({search:email});assert.equal(all.total,179);
  assert.equal((await listCommunicationHistory({search:email,status:"SCHEDULED"})).total,1);
});

test("search values are bound, filters reject stale cursors, and recovered failures leave the issue queue", async () => {
  const first=await listCommunicationHistory({search:email,status:"SENT",limit:1});
  await assert.rejects(listCommunicationHistory({search:"alex@example.org",status:"SENT",cursor:first.nextCursor}),/cursor/);
  assert.throws(()=>historyQuery({status:"DROP TABLE"}),/status/);
  assert.throws(()=>historyQuery({cursor:"not-json"}),/cursor/);
  assert.equal((await listCommunicationHistory({search:"' OR 1=1 --"})).total,0);
  assert.equal((await listCommunicationHistory({search:"alex@example.org",issueOnly:true})).total,1);
  await db.exec(`INSERT INTO "EmailEvent" VALUES ('alex-recovery','partial','alex@example.org','SENT','{}','2026-11-05 22:32',NULL,NULL)`);
  assert.equal((await listCommunicationHistory({search:"alex@example.org",issueOnly:true})).total,0);
});

test("saved recipient snapshots and resend attempts never borrow another recipient or current template", async () => {
  const oldFind=prisma.cohortCommunication.findUnique,oldEvents=prisma.emailEvent.findMany,oldParticipants=prisma.participant.findMany;
  const events=[
    {id:"old",recipientEmail:email,eventType:"SENT",providerMessageId:"msg-one",createdAt:new Date("2026-10-01Z"),eventPayload:{renderedSubject:"Original Lauryn subject",renderedBodyText:"Hi Lauryn, original link",attachments:[{fileName:"Original.pdf"}]}},
    {id:"webhook",recipientEmail:email,eventType:"SENT",providerMessageId:"msg-one.recipient-suffix",createdAt:new Date("2026-10-01T00:00:01Z"),eventPayload:{}},
    {id:"resend",recipientEmail:email,eventType:"SENT",providerMessageId:"msg-two",createdAt:new Date("2026-11-01Z"),eventPayload:{renderedSubject:"Resent Lauryn subject",renderedBodyText:"Hi Lauryn, corrected link"}},
    {id:"alex",recipientEmail:"alex@example.org",eventType:"SENT",providerMessageId:"msg-three",createdAt:new Date("2026-11-02Z"),eventPayload:{renderedSubject:"Alex private subject",renderedBodyText:"Hi Alex"}}
  ];
  prisma.cohortCommunication.findUnique=(async()=>({id:"group",cohortId:"c1",status:"SENT",subject:"Current changed template {{participant.firstName}}",bodyText:"Current changed body",bodyHtml:"",cohort:{title:"New title",presenter:{}},recipientEmails:null,attachments:[],sentAt:new Date("2026-11-02Z")})) as any;
  prisma.emailEvent.findMany=(async({where}:any)=>where.eventType?events.filter(e=>e.recipientEmail===where.recipientEmail.equals):events.map(({eventPayload,...e})=>e)) as any;
  prisma.participant.findMany=(async()=>[]) as any;
  try {
    const detail=await getCommunicationHistoryDetail("group",email);
    assert.equal(detail.content?.subject,"Resent Lauryn subject");assert.equal(detail.attempts.length,2);
    assert.equal(detail.attempts[1].content.subject,"Original Lauryn subject");
    assert.equal(JSON.stringify(detail.attempts).includes("Alex"),false);
    const alex=await getCommunicationHistoryDetail("group","alex@example.org");
    assert.equal(alex.content?.subject,"Alex private subject");
    assert.equal(alex.attempts.length,1);
    const group=await getCommunicationHistoryDetail("group");assert.equal(group.content,null);assert.equal(group.attempts.length,0);
    await assert.rejects(getCommunicationHistoryDetail("group","stranger@example.org"),/No recorded history/);
  } finally {prisma.cohortCommunication.findUnique=oldFind;prisma.emailEvent.findMany=oldEvents;prisma.participant.findMany=oldParticipants;}
});

test("ambiguous older recipient records get a labeled reconstruction without another participant's name",async()=>{
  const oldFind=prisma.cohortCommunication.findUnique,oldEvents=prisma.emailEvent.findMany,oldParticipants=prisma.participant.findMany;
  prisma.cohortCommunication.findUnique=(async()=>({id:"legacy",cohortId:"c1",status:"SENT",subject:"Hello {{participant.firstName}}",bodyText:"Welcome {{participant.fullName}} to {{cohort.title}}",bodyHtml:"",cohort:{title:"Recorded cohort",presenter:{}},recipientEmails:[email],attachments:[],sentAt:new Date("2026-09-08Z")})) as any;
  prisma.emailEvent.findMany=(async()=>[]) as any;
  prisma.participant.findMany=(async()=>[{firstName:"Wrong Person A"},{firstName:"Wrong Person B"}]) as any;
  try{
    const detail=await getCommunicationHistoryDetail("legacy",email);
    assert.equal(detail.content?.provenance,"reconstructed");
    assert.ok(detail.content?.warnings.some(warning=>warning.includes("participant")));
    assert.equal(detail.content?.bodyText.includes("Wrong Person"),false);
    assert.equal(detail.content?.bodyText.includes("Recorded cohort"),true);
    assert.equal(detail.attempts.length,1);
  }finally{prisma.cohortCommunication.findUnique=oldFind;prisma.emailEvent.findMany=oldEvents;prisma.participant.findMany=oldParticipants;}
});

test("legacy communications callers still receive an array rather than a pagination envelope",async()=>{
  const original=prisma.cohortCommunication.findMany;
  prisma.cohortCommunication.findMany=(async()=>[]) as any;
  try{const response=await GET(new Request("https://local.invalid/api/communications?limit=10"));assert.deepEqual((await response.json()).data,[]);}finally{prisma.cohortCommunication.findMany=original;}
});

test("historical reconstruction is labeled, missing context stays explicit, and immediate sends show Sent", () => {
  const content=reconstructHistoryContent({subject:"Welcome {{participant.firstName}}",bodyText:"{{cohort.title}} with {{participant.fullName}}"},{cohort:{title:"Old cohort"}});
  assert.equal(content.provenance,"reconstructed");assert.ok(content.warnings.length);assert.ok(!content.bodyText.includes("Instructional Leadership Spring"));
  assert.equal(historyTiming({sentAt:"2026-11-05T22:30:00Z",scheduledFor:null,status:"SENT"}).label,"Sent");
  assert.equal(displayHistorySubject({subject:"Literal {{token}}",subjectIsSnapshot:true}),"Literal {{token}}");
  assert.equal(sentHistoryAttempts([{id:"1",recipientEmail:email,eventType:"SENT",createdAt:"2026-01-01"},{id:"1",recipientEmail:email,eventType:"SENT",createdAt:"2026-01-01"}],email).length,1);
  const html=isolatedEmailDocument('<meta http-equiv="refresh" content="0;url=https://tracker.invalid"><img src="https://tracker.invalid/pixel"><script>fetch("https://tracker.invalid")</script>');
  assert.ok(html.includes("img-src data:"));assert.ok(html.includes("script-src 'none'"));assert.ok(!html.includes('http-equiv="refresh"'));
  assert.equal(emailSearchRecipient(` ${email.toUpperCase()} `),email);
});

test("participant email summaries select metadata without loading rendered bodies", async () => {
  const original=prisma.emailEvent.findMany;
  prisma.emailEvent.findMany=(async({select}:any)=>{assert.equal(select.eventPayload,undefined);assert.equal(select.reviewedAt,true);return [{id:"e",communicationId:"c",recipientEmail:email,eventType:"SENT",createdAt:new Date(),reviewedAt:null}];}) as any;
  try {assert.equal((await getRecipientCommunicationSummary([email]))[email].sentCount,1);}finally{prisma.emailEvent.findMany=original;}
});

test("shared recipient threads deduplicate events and retain only that recipient's saved content",async()=>{
  const oldQuery=prisma.$queryRaw,oldFind=prisma.cohortCommunication.findMany,oldEvents=prisma.emailEvent.findMany;
  const communication={id:"group",subject:"Template {{participant.firstName}}",createdAt:new Date("2026-11-01Z"),sentAt:new Date("2026-11-01Z"),attachments:[]};
  const own={id:"own",communicationId:"group",recipientEmail:email,eventType:"SENT",createdAt:new Date("2026-11-01Z"),eventPayload:{renderedSubject:"Lauryn only",renderedBodyText:"Private Lauryn content"},communication};
  const other={...own,id:"other",recipientEmail:"alex@example.org",eventPayload:{renderedSubject:"Alex only",renderedBodyText:"Private Alex content"}};
  prisma.$queryRaw=(async()=>[{id:"group"}]) as any;
  prisma.cohortCommunication.findMany=(async()=>[{...communication,emailEvents:[other,own]}]) as any;
  prisma.emailEvent.findMany=(async()=>[own]) as any;
  try{
    const thread=await getRecipientCommunicationThread(` ${email.toUpperCase()} `);
    assert.equal(thread.length,1);assert.equal(thread[0].events.length,1);assert.equal(thread[0].emailEvents.length,1);
    assert.equal(thread[0].emailEvents[0].eventPayload.renderedBodyText,"Private Lauryn content");
    assert.equal(JSON.stringify(thread).includes("Private Alex content"),false);
  }finally{prisma.$queryRaw=oldQuery;prisma.cohortCommunication.findMany=oldFind;prisma.emailEvent.findMany=oldEvents;}
});

test("a newer resend without a snapshot never displays an older attempt's personalized subject",async()=>{
  await db.exec(`
    INSERT INTO "CohortCommunication" VALUES ('resend-old','c1','s1','t1','CUSTOM','["${email}"]','Current subject: {{cohort.title}}','SENT','2026-11-01','2026-11-06',NULL,'2026-11-06');
    INSERT INTO "EmailEvent" VALUES
      ('old-snapshot','resend-old','${email}','SENT','{"renderedSubject":"Obsolete original subject"}','2026-11-01',NULL,'provider-old'),
      ('new-webhook','resend-old','${email}','SENT','{}','2026-11-06 00:00:01',NULL,'provider-new.suffix');
  `);
  let result=await listCommunicationHistory({search:email,status:"SENT"});
  assert.equal(result.rows[0].id,"resend-old");assert.equal(result.rows[0].subject,"Current subject: Building Thinking Classrooms");
  await db.exec(`INSERT INTO "EmailEvent" VALUES ('new-snapshot','resend-old','${email}','SENT','{"renderedSubject":"Actual new subject"}','2026-11-06',NULL,'provider-new')`);
  result=await listCommunicationHistory({search:email,status:"SENT"});
  assert.equal(result.rows[0].subject,"Actual new subject");
});
