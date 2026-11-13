import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { attachFinancialReconciliation } from "../src/services/financialRosterReconciliationService";
import { financialSignature, reconcileFinancialRoster, type FinancialRegistration } from "../src/lib/financialRosterReconciliation";

const args=process.argv.slice(2);
const output=args[args.indexOf("--output")+1];
if(!args.includes("--output")||!output||output.startsWith("--"))throw new Error("Pass --output /private/tmp/financial-roster-audit.json. Identifying results are written to that private file, never stdout.");
function report(r:FinancialRegistration & {id:string;organization?:{name:string};cohort?:FinancialRegistration["cohort"] & {title?:string}}) {
 const x=reconcileFinancialRoster(r);
 return {registrationId:r.id,organization:r.organization?.name,program:r.cohort?.title,sessionCount:x.sessionCount,registrationAmountCents:x.registrationTotalCents,purchasedSeats:x.purchasedSeats,potentialSeats:x.potentialSeats,savedParticipants:x.savedParticipants,missingParticipants:x.missingParticipants,excessParticipants:x.excessParticipants,potentialMissingParticipants:x.potentialMissingParticipants,status:x.status,seatsVerified:x.seatsVerified,pricingBasis:x.pricingBasis,severity:x.severity,reason:x.explanation};
}
async function main(){
 let records:ReturnType<typeof report>[]=[];
 if(args.includes("--fixtures")){
   for(const [total,saved,expected]of [[990,1,1],[10010,1,1],[10010,22,22]]){
    const r:FinancialRegistration & {id:string;organization:{name:string}}={id:`sanitized-${total}-${saved}`,organization:{name:"Sanitized QA organization"},cohortId:"example-cohort",cohort:{_count:{sessions:5}},participantCount:expected,totalAmount:total,participants:Array.from({length:saved},(_,i)=>({email:`qa${i}@example.org`,status:"REGISTERED"}))};
    records.push(report(r));
    records.push(report({...r,id:r.id+"-reviewed",financialReview:{kind:"PRICING_2025",adjustmentCents:0,sourceReference:"Sanitized independently verified 2025 contract",reason:"Sanitized fixture with no taxes, discounts, credits or other adjustments.",reviewedAt:new Date().toISOString(),reviewedBy:"qa",signature:financialSignature(r)}}));
   }
 }else{
   const url=new URL(process.env.DATABASE_URL??"");
   if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new Error("This local-only audit refuses remote databases. Use an approved local snapshot; no production access is performed.");
   const db=new PrismaClient();
   try{
     records=await db.$transaction(async tx=>{
       await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
       const rows=await tx.registration.findMany({where:{archivedAt:null,status:{not:"CANCELLED"}},select:{id:true,cohortId:true,participantCount:true,totalAmount:true,paymentMethod:true,paymentStatus:true,pendingChanges:true,status:true,organization:{select:{name:true}},cohort:{select:{title:true,pricePerParticipant:true,_count:{select:{sessions:true}}}},participants:{select:{email:true,status:true}},invoiceDrafts:{select:{id:true,status:true,totalAmount:true,subtotalAmount:true,taxAmount:true,lineItems:{select:{id:true,quantity:true,unitAmount:true,totalAmount:true}}}},paymentRecords:{select:{id:true,amount:true,status:true}}},orderBy:{id:"asc"}});
       const enriched=await attachFinancialReconciliation(rows,tx);
       return enriched.map(report);
     },{isolationLevel:"RepeatableRead",timeout:120000});
   }finally{await db.$disconnect();}
 }
 await writeFile(output,JSON.stringify({generatedAt:new Date().toISOString(),source:args.includes("--fixtures")?"sanitized-fixtures":"local-read-only-snapshot",records},null,2),{mode:0o600,flag:"wx"});
 const counts=records.reduce<Record<string,number>>((a,r)=>{a[r.status]=(a[r.status]??0)+1;return a;},{});
 console.log(JSON.stringify({records:records.length,statusCounts:counts,readOnly:true,notificationsSent:0}));
}
main().catch(()=>{console.error("Audit could not complete. Check the local database and output path; no identifying records are logged.");process.exitCode=1;});
