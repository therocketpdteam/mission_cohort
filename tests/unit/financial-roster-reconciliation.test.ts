import test from "node:test";
import assert from "node:assert/strict";
import { financialSignature, inferSeatCandidates, pricing2025Reference, reconcileFinancialRoster, type FinancialRegistration, type FinancialReview } from "../../src/lib/financialRosterReconciliation";
const roster=(n:number)=>Array.from({length:n},(_,i)=>({email:`person${i}@example.org`,status:"REGISTERED"}));
export function sample(total=10010,saved=1,expected=1):FinancialRegistration {
 return {id:"sanitized-registration",cohortId:"example-cohort",totalAmount:total,participantCount:expected,paymentMethod:"INVOICE",status:"CONFIRMED",cohort:{pricePerParticipant:795,_count:{sessions:5}},participants:roster(saved),paymentRecords:[{id:"p1",amount:total,status:"PAID"}],invoiceDrafts:[],pendingChanges:null};
}
function reviewed(r:FinancialRegistration,kind:FinancialReview["kind"]="PRICING_2025",extras:Partial<FinancialReview>={}) {
 return {...r,financialReview:{kind,sourceReference:"Verified signed historical contract",reason:"Confirmed rates and all adjustments from independent contract evidence.",reviewedAt:"2026-11-13",reviewedBy:"qa-admin",signature:financialSignature(r),adjustmentCents:0,...extras}};
}
for(const [total,saved,expected,status,missing] of [[990,1,2,"MISSING_PARTICIPANTS",1],[990,2,2,"VERIFIED",0],[10010,1,22,"MISSING_PARTICIPANTS",21],[10010,22,22,"VERIFIED",0]] as const){
 test(`verified historical contract ${total} with ${saved} participants is ${status}`,()=>{
  const r=reviewed(sample(total,saved,expected));const result=reconcileFinancialRoster(r);
  assert.equal(result.status,status);assert.equal(result.missingParticipants,missing);assert.equal(result.seatsVerified,true);
 });
}
test("incorrect expected-seat count no longer establishes complete registration",()=>{
 const r=sample();const possible=reconcileFinancialRoster(r);assert.equal(possible.status,"NEEDS_REVIEW");assert.equal(possible.potentialSeats,22);assert.equal(possible.potentialMissingParticipants,21);assert.equal(possible.purchasedSeats,null);assert.equal(possible.blocksCompletion,true);
 const confirmed=reconcileFinancialRoster(reviewed(r));assert.equal(confirmed.status,"MISSING_PARTICIPANTS");assert.equal(confirmed.missingParticipants,21);
 const rosterFixed=reconcileFinancialRoster(reviewed(sample(10010,22,1)));assert.equal(rosterFixed.status,"NEEDS_REVIEW");assert.equal(rosterFixed.seatsVerified,true);
});
test("every historical tier boundary and supported session count uses its own volume rate",()=>{
 for(const sessions of [3,4,5,8])for(const count of [1,4,5,9,10,19,20,49,50,99,100,101,1000000]){
  const tier=pricing2025Reference.tiers.find(t=>count>=t.min&&count<=t.max)!;
  const unit=(tier.rates as Record<number,number>)[sessions];assert.ok(inferSeatCandidates(count*unit*100,sessions).includes(count),`${sessions}/${count}`);
 }
 assert.deepEqual(inferSeatCandidates(1001000,5),[22]);
});
test("current price and registration year never automatically establish historical rates",()=>{
 const r=sample(990,2,2);assert.equal(reconcileFinancialRoster(r).status,"NEEDS_REVIEW");assert.equal(reconcileFinancialRoster(reviewed(r)).status,"VERIFIED");
 const changedSchedule={id:"other-year",tiers:pricing2025Reference.tiers.map(t=>({...t,rates:{...t.rates,5:t.rates[5]+100}}))};assert.deepEqual(inferSeatCandidates(99000,5,changedSchedule),[]);
});
test("partial or excess payments do not determine contracted seats",()=>{
 for(const received of [1,495,990,5000]){const r=sample(990,2,2);r.paymentRecords=[{id:"p1",status:"PARTIALLY_PAID",amount:received}];assert.equal(reconcileFinancialRoster(reviewed(r)).status,"VERIFIED");}
});
test("explicit independent quantity supports custom discounts, complementary seats and nonstandard sessions",()=>{
 const r=sample(777,4,4);r.cohort!._count!.sessions=6;
 assert.equal(reconcileFinancialRoster(r).status,"NEEDS_REVIEW");assert.equal(reconcileFinancialRoster(reviewed(r,"QUANTITY",{quantity:4})).status,"VERIFIED");
 const comped=sample(0,3,3);comped.paymentMethod="COMPED";assert.equal(reconcileFinancialRoster(comped).status,"NEEDS_REVIEW");assert.equal(reconcileFinancialRoster(reviewed(comped,"QUANTITY",{quantity:3})).status,"VERIFIED");
});
test("taxes, multiple invoices and refunds require explicit resolution and suppress precise default inference",()=>{
 for(const invoices of [[{id:"i1",taxAmount:10,totalAmount:990,lineItems:[]}],[{id:"i1",totalAmount:990},{id:"i2",totalAmount:990}]] ){
  const r=sample(990,1,1);r.invoiceDrafts=invoices;const x=reconcileFinancialRoster(r);assert.equal(x.status,"NEEDS_REVIEW");assert.equal(x.potentialMissingParticipants,null);
 }
 const r=sample(990,1,1);r.paymentRecords=[{id:"refund",amount:495,status:"REFUNDED"}];assert.equal(reconcileFinancialRoster(r).potentialSeats,null);
});
test("reviewed historical adjustments are applied to contract amount in integer cents",()=>{
 const r=sample(940,2,2);assert.equal(reconcileFinancialRoster(reviewed(r,"PRICING_2025",{adjustmentCents:-5000})).status,"VERIFIED");
 assert.equal(reconcileFinancialRoster(reviewed(r)).status,"NEEDS_REVIEW");
});
test("generated invoice quantities cannot independently verify seats",()=>{
 const r=sample();r.invoiceDrafts=[{id:"generated",totalAmount:10010,lineItems:[{quantity:1,unitAmount:10010,totalAmount:10010}]}];const x=reconcileFinancialRoster(r);assert.equal(x.status,"NEEDS_REVIEW");assert.equal(x.potentialSeats,22);
});
test("verified quantities identify excess participants, missing roster and duplicate or invalid emails",()=>{
 assert.equal(reconcileFinancialRoster(reviewed(sample(990,3,2))).status,"EXCESS_PARTICIPANTS");
 assert.equal(reconcileFinancialRoster(reviewed(sample(990,0,2))).missingParticipants,2);
 const r=sample(990,2,2);r.participants![1].email="PERSON0@EXAMPLE.ORG";const x=reconcileFinancialRoster(reviewed(r));assert.equal(x.savedParticipants,1);assert.equal(x.status,"NEEDS_REVIEW");
 r.participants![1].email="invalid";assert.equal(reconcileFinancialRoster(reviewed(r)).savedParticipants,1);
 r.participants![1]={email:"poc@example.org",status:"CANCELLED"};assert.equal(reconcileFinancialRoster(reviewed(r)).missingParticipants,1);
});
test("no financial amount, ambiguous price matches and non-seat-based registrations",()=>{
 const r=sample();r.totalAmount=undefined;assert.equal(reconcileFinancialRoster(r).potentialSeats,null);
 const ambiguous={id:"ambiguous",tiers:[{min:1,max:1,rates:{3:100,4:100,5:100,8:100}},{min:2,max:2,rates:{3:50,4:50,5:50,8:50}}]};assert.deepEqual(inferSeatCandidates(10000,5,ambiguous),[1,2]);
 assert.equal(reconcileFinancialRoster(reviewed(sample(),"NOT_SEAT_BASED")).status,"NOT_APPLICABLE");
});
test("financial changes invalidate reviews while adding roster participants recomputes safely",()=>{
 const r=reviewed(sample(990,1,2));assert.equal(reconcileFinancialRoster(r).status,"MISSING_PARTICIPANTS");r.participants=roster(2);assert.equal(reconcileFinancialRoster(r).status,"VERIFIED");
 r.totalAmount=1200;assert.equal(reconcileFinancialRoster(r).status,"NEEDS_REVIEW");
 const refunded=reviewed(sample(990,2,2));refunded.paymentStatus="REFUNDED";assert.equal(reconcileFinancialRoster(refunded).status,"NEEDS_REVIEW");
 const pending=reviewed(sample(990,2,2));pending.pendingChanges={fields:{totalAmount:{before:990,after:1200}}};assert.equal(reconcileFinancialRoster(pending).status,"NEEDS_REVIEW");
});
