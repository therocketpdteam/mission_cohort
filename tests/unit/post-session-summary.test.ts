import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma";
import { listSessionPostSessionEmails } from "../../src/services/communicationService";

test("session summaries use canonical messages, frozen retry audience counts and distinct current recipients", async () => {
  const originals = [prisma.cohortCommunication.findMany, prisma.auditLog.findMany, prisma.participant.findMany];
  const message = { id: "m1", cohortId: "c1", sessionId: "s1", scheduledFor: new Date(Date.now()+3600000), sentAt: null, status: "FAILED", providerError: "partial rejection", recipientScope: "ALL_PARTICIPANTS", recipientEmails: null, template: { type: "FOLLOW_UP" }, session: { endTime: new Date(Date.now()-3600000), recordingUrl: "https://example.org/recording" } };
  let participantReads = 0;
  prisma.cohortCommunication.findMany = (async (query: any) => {
    assert.equal(query.where.cohortId, "c1"); assert.equal(query.select.bodyHtml, undefined);
    return [message, {...message,id:"duplicate"}, {...message,id:"m2",sessionId:"s2",status:"SCHEDULED"}];
  }) as any;
  prisma.auditLog.findMany = (async () => [{ entityId: "m1", metadata: { targets: [{email:"old-a@example.org"},{email:"old-b@example.org"},{email:"old-c@example.org"}] } }]) as any;
  prisma.participant.findMany = (async (query: any) => { participantReads++;assert.deepEqual(query.select,{email:true});return [{email:"A@example.org"},{email:"a@EXAMPLE.ORG"},{email:"b@example.org"}]; }) as any;
  try {
    const summaries = await listSessionPostSessionEmails("c1");
    assert.equal(summaries.length,2);assert.equal(summaries[0].id,"m1");assert.equal(summaries[0].recipientCount,3);assert.equal(summaries[1].recipientCount,2);assert.equal(participantReads,1);
    assert.ok(summaries.every(row=>row.eligible));assert.equal((summaries[0] as any).bodyHtml,undefined);
  } finally { [prisma.cohortCommunication.findMany,prisma.auditLog.findMany,prisma.participant.findMany]=originals as any; }
});
