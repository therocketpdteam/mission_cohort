import test from "node:test";
import assert from "node:assert/strict";
import {sessionPhase,postSessionPresentation} from "../../src/components/admin/cohortOverviewPresentation";
const now=Date.parse("2026-11-13T18:00:00Z");
test("session phase uses start/end instants and offset-equivalent dates",()=>{
 assert.equal(sessionPhase({startTime:"2026-11-13T19:00:00Z",endTime:"2026-11-13T20:00:00Z"},now).label,"Upcoming");
 assert.equal(sessionPhase({startTime:"2026-11-13T17:00:00Z",endTime:"2026-11-13T19:00:00Z"},now).label,"In Progress");
 assert.equal(sessionPhase({startTime:"2026-11-13T11:00:00-05:00",endTime:"2026-11-13T13:00:00-05:00"},now).label,"Completed");
});
test("configuration blockers are attention states rather than asserted delivery failures",()=>{
 const base={status:"FAILED",scheduledFor:"2026-11-13T20:00:00Z"};
 for(const providerError of ["SendGrid is not configured. Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.","Outbound safety mode blocked 1 email recipient.","SendGrid rejected the saved API key with status 401."]){
  const view=postSessionPresentation({...base,providerError},true,true,now);assert.equal(view.label,"Needs Attention");assert.equal(view.tone,"attention");assert.equal(view.configuration,true);
 }
 assert.equal(postSessionPresentation({...base,providerError:"Provider rejected delivery"},true,true,now).label,"Delivery Failed");
 assert.equal(postSessionPresentation({...base,providerError:"Unknown error"},false,true,now).label,"Needs Attention");
});
test("email presentation respects eligibility and successful status without modifying input",()=>{
 const base={status:"SCHEDULED",scheduledFor:"2026-11-13T20:00:00Z"};const before=JSON.stringify(base);
 assert.equal(postSessionPresentation(base,false,false,now).label,"Scheduled");
 assert.equal(postSessionPresentation(base,true,true,now).label,"Ready to Send");
 assert.equal(postSessionPresentation(base,false,true,now).review,true);
 assert.equal(postSessionPresentation({...base,status:"SENT"},false,true,now).label,"Sent");
 assert.equal(JSON.stringify(base),before);
});
