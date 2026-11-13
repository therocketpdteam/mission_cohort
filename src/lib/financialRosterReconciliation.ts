import { countPendingRegistrationChanges } from "./registrationPendingChanges";
// This reference is supplied historical evidence, not an automatic pricing-year assignment.
export const pricing2025Reference = {
  id: "rocketpd-2025-reference",
  tiers: [
    { min: 1, max: 4, rates: { 3: 295, 4: 395, 5: 495, 8: 795 } },
    { min: 5, max: 9, rates: { 3: 285, 4: 385, 5: 485, 8: 785 } },
    { min: 10, max: 19, rates: { 3: 275, 4: 375, 5: 465, 8: 765 } },
    { min: 20, max: 49, rates: { 3: 265, 4: 365, 5: 455, 8: 755 } },
    { min: 50, max: 99, rates: { 3: 255, 4: 355, 5: 445, 8: 745 } },
    { min: 100, max: Infinity, rates: { 3: 245, 4: 345, 5: 425, 8: 725 } }
  ]
};
export const reconciliationStatuses = ["VERIFIED", "MISSING_PARTICIPANTS", "EXCESS_PARTICIPANTS", "NEEDS_REVIEW", "NOT_APPLICABLE"] as const;
export type ReconciliationStatus = typeof reconciliationStatuses[number];
export type FinancialReview = { kind: "QUANTITY" | "PRICING_2025" | "NOT_SEAT_BASED"; quantity?: number; adjustmentCents?: number; sourceReference: string; reason: string; signature: string; reviewedAt: string; reviewedBy: string };
export type FinancialRegistration = {
  id?: string; cohortId?: string; participantCount?: unknown; totalAmount?: unknown; paymentMethod?: unknown; paymentStatus?: unknown; status?: string; archivedAt?: unknown;
  cohort?: { pricePerParticipant?: unknown; _count?: { sessions?: number }; sessions?: unknown[] };
  participants?: Array<{ email?: string | null; status?: string }>;
  invoiceDrafts?: Array<{ id: string; status?: string; totalAmount?: unknown; subtotalAmount?: unknown; taxAmount?: unknown; paidAmount?: unknown; lineItems?: Array<{ id?: string; quantity?: unknown; unitAmount?: unknown; totalAmount?: unknown }> }>;
  paymentRecords?: Array<{ id: string; amount?: unknown; status?: string }>;
  pendingChanges?: unknown; financialReview?: FinancialReview | null;
};
const amount = (value: unknown) => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
export const sessionCount = (r: FinancialRegistration) => Number(r.cohort?._count?.sessions ?? r.cohort?.sessions?.length ?? 0);
const liveInvoices = (r: FinancialRegistration) => (r.invoiceDrafts ?? []).filter(row => !["VOIDED", "CANCELLED"].includes(row.status ?? ""));
// No names, email addresses, bodies or attachments in the evidence signature.
// Roster edits alone do not invalidate a verified contract; financial/seat edits do.
export function financialSignature(r: FinancialRegistration) {
  return JSON.stringify({ cohort: r.cohortId, sessions: sessionCount(r), configuredPrice: amount(r.cohort?.pricePerParticipant), expected: Number(r.participantCount ?? 0), total: amount(r.totalAmount), method: r.paymentMethod, refunded: r.paymentStatus === "REFUNDED",
    invoices: liveInvoices(r).map(i => ({ id: i.id, total: amount(i.totalAmount), subtotal: amount(i.subtotalAmount), tax: amount(i.taxAmount), lines: (i.lineItems ?? []).map(l => ({ id:l.id, quantity:Number(l.quantity), unit:amount(l.unitAmount), total:amount(l.totalAmount) })).sort((a,b)=>(a.id??"").localeCompare(b.id??"")) })).sort((a,b)=>a.id.localeCompare(b.id)),
    refunds: (r.paymentRecords ?? []).filter(p=>p.status === "REFUNDED").map(p=>({id:p.id,amount:amount(p.amount)})).sort((a,b)=>a.id.localeCompare(b.id)) });
}
export function inferSeatCandidates(totalCents: number, sessions: number, schedule = pricing2025Reference) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return [];
  const candidates: number[] = [];
  // Enumerate tiers and solve only within each tier's quantity interval; no arbitrary seat cap.
  for (const tier of schedule.tiers) {
    const unit = (tier.rates as Record<number,number>)[sessions];
    if (!unit || !Number.isFinite(unit) || unit <= 0) continue;
    const count = totalCents / Math.round(unit * 100);
    if (Number.isSafeInteger(count) && count >= tier.min && count <= tier.max) candidates.push(count);
  }
  return [...new Set(candidates)];
}
export function reconcileFinancialRoster(r: FinancialRegistration) {
  const active = (r.participants ?? []).filter(p => !p.status || p.status === "REGISTERED");
  const emails = active.map(p=>String(p.email??"").trim().toLowerCase()).filter(email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const saved = new Set(emails).size;
  const invalidOrDuplicate = active.length !== saved;
  const expected = Number(r.participantCount ?? 0);
  const totalCents = amount(r.totalAmount);
  const invoices = liveInvoices(r);
  const review = r.financialReview;
  const reviewValid = Boolean(review && review.signature === financialSignature(r));
  const candidates = totalCents == null ? [] : inferSeatCandidates(totalCents, sessionCount(r));
  const hasUnknownAdjustments = r.paymentStatus === "REFUNDED" || invoices.length > 1 || invoices.some(i=>Number(i.taxAmount??0)!==0 || amount(i.totalAmount)!==totalCents || (i.lineItems?.length ?? 0)>1) || (r.paymentRecords??[]).some(p=>p.status === "REFUNDED");
  const result = { status: "NEEDS_REVIEW" as ReconciliationStatus, purchasedSeats: null as number|null, seatsVerified: false, savedParticipants: saved, storedExpectedSeats: expected, missingParticipants: null as number|null, excessParticipants: null as number|null,
    potentialSeats: !hasUnknownAdjustments && candidates.length === 1 ? candidates[0] : null,
    potentialMissingParticipants: !hasUnknownAdjustments && candidates.length === 1 ? Math.max(candidates[0]-saved,0) : null,
    registrationTotalCents: totalCents, sessionCount:sessionCount(r), severity:"REVIEW", pricingBasis:"Historical pricing not verified", explanation:"Purchased seats cannot be verified from stored expected seats or automatically generated invoice quantities alone.", invoiceQuantities:invoices.map(i=>({invoiceId:i.id, quantities:(i.lineItems??[]).map(l=>Number(l.quantity??0))})), blocksCompletion:true };
  if (r.archivedAt || r.status === "CANCELLED") { result.explanation="Inactive registration: excluded from active reconciliation follow-up. Historical financial evidence remains reviewable."; return result; }
  if (!reviewValid) {
    if (review) result.explanation="Financial or seat records changed after the last review. Verify the evidence again.";
    else if (hasUnknownAdjustments) result.explanation="Multiple invoices, taxes, credits/refunds or conflicting amounts require review; no precise missing-seat estimate is asserted.";
    else if (candidates.length===1) { result.pricingBasis="2025 reference — applicability unverified"; result.explanation=`The unverified 2025 reference is consistent with ${candidates[0]} seats. Confirm the historical rate, invoice revisions and adjustments before treating this as purchased seats.`; result.severity=candidates[0]-saved>=10?"HIGH":"REVIEW"; }
    return result;
  }
  if (review!.kind === "NOT_SEAT_BASED") return {...result,status:"NOT_APPLICABLE" as const,pricingBasis:review!.sourceReference,explanation:review!.reason,blocksCompletion:false};
  let purchased = review!.quantity;
  if (review!.kind === "PRICING_2025") {
    const matches = totalCents == null ? [] : inferSeatCandidates(totalCents-(review!.adjustmentCents??0),sessionCount(r));
    if (matches.length !== 1) return {...result,explanation:"The reviewed historical pricing and declared net adjustments do not identify one seat quantity."};
    purchased=matches[0];
  }
  if (!Number.isSafeInteger(purchased) || purchased! < 0) return {...result,explanation:"Reviewed purchased-seat quantity is unavailable."};
  result.purchasedSeats=purchased!;result.seatsVerified=true;result.pricingBasis=`${review!.kind === "PRICING_2025" ? "Verified 2025 pricing" : "Verified contracted quantity"}: ${review!.sourceReference}`;
  result.missingParticipants=Math.max(purchased!-saved,0);result.excessParticipants=Math.max(saved-purchased!,0);
  result.potentialSeats=null;result.potentialMissingParticipants=null;
  if (invalidOrDuplicate) return {...result,explanation:"Duplicate, blank or invalid roster identities require review. Counts use distinct active email addresses."};
  if (result.missingParticipants) return {...result,status:"MISSING_PARTICIPANTS" as const,severity:result.missingParticipants>=10?"HIGH":"REVIEW",explanation:`Verified records support ${purchased} seats; ${saved} distinct active participants are saved. ${result.missingParticipants} purchased seats lack participant details.`};
  if (result.excessParticipants) return {...result,status:"EXCESS_PARTICIPANTS" as const,explanation:`${saved} distinct active participants exceed the ${purchased} verified seats.`};
  if (expected !== purchased) return {...result,explanation:`Financially verified seats and saved roster match (${purchased}), but the stored expected-seat count (${expected}) conflicts. Review it without automatically changing billing.`};
  if (countPendingRegistrationChanges(r.pendingChanges) > 0) return {...result,explanation:"Pending registration changes require review before completion."};
  if (totalCents == null || totalCents < 0) return {...result,explanation:"Contract financial amount is unavailable or invalid; resolve it before verification."};
  return {...result,status:"VERIFIED" as const,severity:"NONE",explanation:"Verified purchased seats match the distinct active roster and stored expected seats.",blocksCompletion:false};
}
