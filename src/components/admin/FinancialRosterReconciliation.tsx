"use client";
import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { financialSignature, reconcileFinancialRoster, type FinancialRegistration } from "@/lib/financialRosterReconciliation";
import { Alert, Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Stack, TextField, Typography } from "@/components/ui/primitives";
import { formatStatusLabel } from "@/lib/formatting";
export function FinancialRosterReconciliation({registration,onReviewed}:{registration:FinancialRegistration & {id:string};onReviewed?:()=>Promise<void>|void}) {
  const result=reconcileFinancialRoster(registration);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [kind,setKind]=useState("QUANTITY"),[quantity,setQuantity]=useState(""),[adjustment,setAdjustment]=useState(""),[source,setSource]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
  const money=result.registrationTotalCents==null?"Unavailable":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(result.registrationTotalCents/100);
  async function save(){
    setBusy(true);setError("");
    try { await adminApi(`/api/registrations/${registration.id}/financial-reconciliation`,{method:"POST",body:{kind,quantity:kind==="QUANTITY"?Number(quantity):undefined,adjustmentCents:kind==="PRICING_2025"?Math.round(Number(adjustment)*100):undefined,sourceReference:source,reason,signature:financialSignature(registration),confirmed}}); await onReviewed?.();setOpen(false); }
    catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }
  return <section aria-label="Financial and roster reconciliation" style={{marginTop:16}}>
    <h4>Financial / Roster Reconciliation</h4>
    <Alert severity={result.blocksCompletion?"warning":"success"}>
      <strong>{formatStatusLabel(result.status)}</strong><p>{result.explanation}</p>
    </Alert>
    <div className="registration-preflight-grid">
      <div className="registration-preflight-tile"><span>Purchased seats</span><strong>{result.purchasedSeats??"Not verified"}</strong><p>Stored expected seats: {result.storedExpectedSeats}</p></div>
      <div className="registration-preflight-tile"><span>Saved participants</span><strong>{result.savedParticipants}</strong><p>Distinct active participant email addresses; POC counts only when on the roster.</p></div>
      <div className="registration-preflight-tile"><span>Registration total</span><strong>{money}</strong><p>Contract value, independent of payments received.</p></div>
      <div className="registration-preflight-tile"><span>Seat discrepancy</span><strong>{result.missingParticipants!=null?`${result.missingParticipants} missing / ${result.excessParticipants} excess`:result.potentialMissingParticipants!=null?`${result.potentialMissingParticipants} potentially missing`:"Needs review"}</strong><p>{result.potentialSeats!=null?`Unverified reference suggests ${result.potentialSeats} seats.`:"Only reviewed evidence establishes purchased quantities."}</p></div>
    </div>
    <Typography variant="caption">Pricing basis: {result.pricingBasis}</Typography>
    {result.invoiceQuantities.length?<Typography variant="caption">Stored invoice quantities: {result.invoiceQuantities.map(i=>i.quantities.join(" + ")).join("; ")}. These can be derived from expected seats and require independent verification.</Typography>:null}
    <Button size="small" variant="outlined" onClick={()=>{setError("");setConfirmed(false);setOpen(true);}}>Review financial evidence</Button>
    <Dialog open={open} onClose={busy?undefined:()=>setOpen(false)} fullWidth maxWidth="sm">
      <div role="dialog" aria-modal="true" aria-label="Review financial seat evidence">
      <DialogTitle>Review financial seat evidence</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Typography>Record independently verified evidence. This does not change expected seats, invoices, payments, rosters or send communications. Conflicting invoice revisions, discounts, taxes, credits, refunds and complimentary seats must be resolved in your review.</Typography>
        <TextField select label="Evidence basis" value={kind} onChange={e=>setKind(e.target.value)}>
          <MenuItem value="QUANTITY">Verified purchased / contracted quantity</MenuItem><MenuItem value="PRICING_2025">Verified applicability of 2025 pricing</MenuItem><MenuItem value="NOT_SEAT_BASED">Verified non-seat-based registration</MenuItem>
        </TextField>
        {kind==="QUANTITY"?<TextField label="Verified purchased seats" type="number" value={quantity} onChange={e=>setQuantity(e.target.value)}/>:null}
        {kind==="PRICING_2025"?<><Typography>Confirm the supplied 2025 schedule applies to this contract, regardless of registration date. Other years or custom pricing require a verified quantity.</Typography><TextField label="Net taxes, fees and adjustments ($; negative for discounts)" type="number" value={adjustment} onChange={e=>setAdjustment(e.target.value)}/></>:null}
        <TextField label="Evidence reference (contract, invoice and line, or pricing approval)" value={source} onChange={e=>setSource(e.target.value)}/>
        <TextField label="Review explanation and resolution of adjustments/conflicts" multiline rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I verified the source independently of the stored expected-seat count and resolved financial adjustments.</label>
        {error?<Alert severity="error">{error}</Alert>:null}
      </Stack></DialogContent>
      <DialogActions><Button variant="outlined" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={busy||!confirmed||!source.trim()||reason.trim().length<15||(kind==="QUANTITY"&&quantity==="")||(kind==="PRICING_2025"&&adjustment==="")} onClick={save}>{busy?"Saving…":"Save reviewed evidence"}</Button></DialogActions>
      </div>
    </Dialog>
  </section>;
}
