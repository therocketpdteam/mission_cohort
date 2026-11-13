import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma";
import { financialSignature } from "../../src/lib/financialRosterReconciliation";
import { attachFinancialReconciliation, reviewFinancialRoster } from "../../src/services/financialRosterReconciliationService";
const row=()=>({id:"r1",cohortId:"c1",participantCount:1,totalAmount:10010,paymentMethod:"INVOICE",cohort:{pricePerParticipant:495,_count:{sessions:5}},participants:[{email:"qa@example.org",status:"REGISTERED"}],invoiceDrafts:[],paymentRecords:[]});
test("manual evidence review writes only an audit record and refuses a changed financial snapshot",async()=>{
 const original=prisma.$transaction;const current=row(),writes:any[]=[],queries:any[]=[];
 const tx:any={registration:{findUniqueOrThrow:async()=>current},auditLog:{create:async({data}:any)=>{writes.push(data);return data;}},$queryRaw:async(strings:any,...parameters:any[])=>{queries.push(parameters);return[];}};
 prisma.$transaction=(async(callback:any,options:any)=>{assert.equal(options.isolationLevel,"Serializable");return callback(tx);}) as any;
 const input={kind:"PRICING_2025",adjustmentCents:0,sourceReference:"Reviewed signed 2025 contract",reason:"Verified applicability and all discounts, credits, tax and invoice revisions.",signature:financialSignature(current),confirmed:true};
 try{
  const result=await reviewFinancialRoster("r1",input,"qa-admin");assert.equal(result.status,"MISSING_PARTICIPANTS");assert.equal(result.missingParticipants,21);assert.equal(writes.length,1);assert.equal(writes[0].action,"FINANCIAL_ROSTER_REVIEWED");assert.equal(writes[0].metadata.reviewedBy,"qa-admin");assert.deepEqual(queries[0],["r1"]);
  current.totalAmount=20000;await assert.rejects(reviewFinancialRoster("r1",input,"qa-admin"),/Financial records changed/);assert.equal(writes.length,1);
  await assert.rejects(reviewFinancialRoster("r1",{...input,confirmed:false},"qa-admin"));assert.equal(writes.length,1);
 }finally{prisma.$transaction=original;}
});
test("latest reviewed evidence is attached in one batch and expires after relevant invoice changes",async()=>{
 const r=row();const evidence={kind:"QUANTITY",quantity:22,signature:financialSignature(r),sourceReference:"Independent contract",reason:"All financial adjustments reviewed",reviewedAt:"2026-11-13",reviewedBy:"qa"};
 const client:any={auditLog:{findMany:async(query:any)=>{assert.equal(query.where.action,"FINANCIAL_ROSTER_REVIEWED");return[{entityId:r.id,metadata:evidence},{entityId:r.id,metadata:{...evidence,quantity:1}}];}}};
 const [attached]=await attachFinancialReconciliation([r],client);assert.equal(attached.financialReconciliation.purchasedSeats,22);assert.equal(attached.financialReconciliation.status,"MISSING_PARTICIPANTS");
 const [stale]=await attachFinancialReconciliation([{...r,invoiceDrafts:[{id:"new-invoice",status:"SENT",totalAmount:10010}]}],client);assert.equal(stale.financialReconciliation.status,"NEEDS_REVIEW");assert.equal(stale.financialReconciliation.seatsVerified,false);
});
