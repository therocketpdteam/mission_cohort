import { prisma } from "@/lib/prisma";
import { financialSignature, reconcileFinancialRoster, type FinancialRegistration, type FinancialReview } from "@/lib/financialRosterReconciliation";
import { z } from "zod";

// Shared by list/detail reads and the read-only historical audit. No stored status
// or roster count is repaired as a side effect of reconciliation.
export const reconciliationInclude = {
  cohort: { include: { _count: { select: { sessions: true } } } },
  participants: { select: { email: true, status: true } },
  invoiceDrafts: { include: { lineItems: true } },
  paymentRecords: { select: { id: true, amount: true, status: true } }
} as const;
export async function attachFinancialReconciliation<T extends FinancialRegistration & { id: string }>(rows: T[], client: Pick<typeof prisma,"auditLog"> = prisma) {
  if (!rows.length) return [];
  const audits = await client.auditLog.findMany({ where: { entityType:"Registration", entityId: { in:rows.map(r=>r.id) }, action:"FINANCIAL_ROSTER_REVIEWED" }, orderBy:[{createdAt:"desc"},{id:"desc"}], select:{entityId:true,metadata:true} });
  const reviews = new Map<string,FinancialReview>();
  for (const row of audits) if (!reviews.has(row.entityId)) reviews.set(row.entityId,row.metadata as unknown as FinancialReview);
  return rows.map(row => {
    const financialReview=reviews.get(row.id)??null;
    return {...row,financialReview,financialReconciliation:reconcileFinancialRoster({...row,financialReview})};
  });
}
const reviewSchema=z.object({kind:z.enum(["QUANTITY","PRICING_2025","NOT_SEAT_BASED"]),quantity:z.number().int().min(0).max(1000000).optional(),adjustmentCents:z.number().int().safe().optional(),sourceReference:z.string().trim().min(5).max(500),reason:z.string().trim().min(15).max(3000),signature:z.string().max(100000),confirmed:z.literal(true)}).superRefine((value,ctx)=>{if(value.kind==="QUANTITY"&&value.quantity===undefined)ctx.addIssue({code:"custom",path:["quantity"],message:"Verified quantity is required"});if(value.kind==="PRICING_2025"&&value.adjustmentCents===undefined)ctx.addIssue({code:"custom",path:["adjustmentCents"],message:"Declare net adjustments, including zero"});});
export async function reviewFinancialRoster(registrationId:string,input:unknown,reviewedBy:string) {
  const data=reviewSchema.parse(input);
  return prisma.$transaction(async tx=>{
    // Serialize reviews with ordinary registration mutations, then verify the
    // complete financial snapshot before recording any evidence.
    await tx.$queryRaw`SELECT id FROM "Registration" WHERE id = ${registrationId} FOR UPDATE`;
    const current=await tx.registration.findUniqueOrThrow({where:{id:registrationId},include:reconciliationInclude});
    if(data.signature!==financialSignature(current))throw Object.assign(new Error("Financial records changed. Reload and review the current evidence."),{code:"CONFLICT",status:409});
    const {confirmed:_,...fields}=data;
    const evidence={...fields,reviewedBy,reviewedAt:new Date().toISOString()};
    const result=reconcileFinancialRoster({...current,financialReview:evidence});
    if(data.kind==="PRICING_2025"&&!result.seatsVerified)throw Object.assign(new Error(result.explanation),{code:"BAD_REQUEST",status:400});
    await tx.auditLog.create({data:{entityType:"Registration",entityId:current.id,actorUserId:reviewedBy,action:"FINANCIAL_ROSTER_REVIEWED",metadata:evidence}});
    return result;
  },{isolationLevel:"Serializable"});
}
