import assert from "node:assert/strict";
import test from "node:test";
import { productionQaBccEmail, isQaBccEvent } from "../../src/modules/email/qaCopy";
import { buildSendGridMailPayload } from "../../src/modules/email/sendgridProvider";
import { renderMergeFields, sampleMergeContext } from "../../src/modules/email/mergeFields";
import { recordSendGridEvents, shouldSuppressParticipantBatchQaCopy, shouldSuppressScheduledQaCopy } from "../../src/services/communicationService";

const qaEmail = "gerardo@rocketpd.com";
const config = { fromEmail: "info@rocketpd.com", fromName: "The RocketPD Team", qaBccEmail: qaEmail };
const message = { to: "avery@example.com", subject: "Registration received: DP Fall 2026", html: "<p>Hello Avery, your registration for 4 participants is confirmed.</p>", text: "Hello Avery, your registration for 4 participants is confirmed." };

test("live QA copying is production-only and validates the configured address without blocking normal email", () => {
  assert.equal(productionQaBccEmail("production", " Gerardo@RocketPD.com "), qaEmail);
  for (const environment of ["staging", "local"]) assert.equal(productionQaBccEmail(environment, qaEmail), undefined);
  for (const value of [undefined, "", "not-an-email", "a@example.com, b@example.com", "qa@example.com\r\nBcc: stranger@example.com"]) {
    assert.equal(productionQaBccEmail("production", value), undefined);
  }
});

test("QA uses hidden BCC while preserving original customer To, subject, body, sender, and attachments", () => {
  const input = { ...message, attachments: [{ content: Buffer.from("sample pdf").toString("base64"), filename: "Invoice-DP-2026-437.pdf", type: "application/pdf" }] };
  const normal = buildSendGridMailPayload(input, { fromEmail: config.fromEmail, fromName: config.fromName });
  const copied = buildSendGridMailPayload(input, config);
  assert.deepEqual(copied.personalizations[0].to, [{ email: "avery@example.com" }]);
  assert.deepEqual(copied.personalizations[0].bcc, [{ email: qaEmail }]);
  assert.ok(!("cc" in copied.personalizations[0]));
  assert.deepEqual(copied.content, normal.content);
  assert.equal(copied.subject, normal.subject);
  assert.deepEqual(copied.from, normal.from);
  assert.deepEqual(copied.attachments, normal.attachments);
  assert.ok(!copied.content.some((part) => part.value.includes(qaEmail)));
  assert.deepEqual(copied.personalizations[0].custom_args, { mc_qa_bcc_email: qaEmail, mc_intended_recipient: "avery@example.com" });
});

test("identical bulk messages keep private customer envelopes and add the QA address only once", () => {
  const payload = buildSendGridMailPayload({ ...message, to: [" AVERY@example.com ", "jordan@example.com", "avery@example.com"] }, config);
  assert.deepEqual(payload.personalizations.map((row) => row.to), [[{ email: "avery@example.com" }], [{ email: "jordan@example.com" }]]);
  assert.equal(payload.personalizations.flatMap((row) => row.bcc ?? []).filter((row) => row.email === qaEmail).length, 1);
});

test("a real message to Gerardo is not also BCC'd to him, including mixed-recipient batches", () => {
  for (const to of [" Gerardo@RocketPD.com ", ["avery@example.com", "Gerardo@RocketPD.com"]]) {
    const payload = buildSendGridMailPayload({ ...message, to }, config);
    assert.ok(payload.personalizations.every((row) => !row.bcc && !row.custom_args));
  }
});

test("missing or malformed QA configuration leaves the customer's request unchanged", () => {
  const normal = buildSendGridMailPayload(message, { fromEmail: config.fromEmail });
  assert.deepEqual(buildSendGridMailPayload(message, { fromEmail: config.fromEmail, qaBccEmail: "invalid" }), normal);
  assert.deepEqual(buildSendGridMailPayload(message, { fromEmail: config.fromEmail, qaBccEmail: productionQaBccEmail("staging", qaEmail) }), normal);
});

test("a caller can suppress duplicate QA copies after the first personalized envelope", () => {
  const first = buildSendGridMailPayload(message, config);
  const later = buildSendGridMailPayload({ ...message, to: "jordan@example.com", suppressQaBcc: true }, config);
  assert.deepEqual(first.personalizations[0].bcc, [{ email: qaEmail }]);
  assert.ok(!later.personalizations[0].bcc);
  assert.ok(!later.personalizations[0].custom_args);
  assert.deepEqual(later.personalizations[0].to, [{ email: "jordan@example.com" }]);
});

test("only the deterministic scheduled milestone leader keeps the QA copy", () => {
  assert.equal(shouldSuppressScheduledQaCopy("leader", "leader"), false);
  assert.equal(shouldSuppressScheduledQaCopy("participant-2", "leader"), true);
  assert.equal(shouldSuppressScheduledQaCopy("participant-2", null), false);
});

test("personalized whole-roster sends keep one QA copy unless the caller suppresses the entire batch", () => {
  assert.equal(shouldSuppressParticipantBatchQaCopy(0), false);
  assert.equal(shouldSuppressParticipantBatchQaCopy(1), true);
  assert.equal(shouldSuppressParticipantBatchQaCopy(0, true), true);
  assert.equal(shouldSuppressParticipantBatchQaCopy(200, true), true);
});

test("personalized POC and participant messages each carry their exact rendered content into the QA copy", () => {
  const poc = renderMergeFields("Hello {{registration.primaryContactFirstName}}, your invoice {{registration.invoiceNumber}} is ready.", sampleMergeContext).output;
  const participant = renderMergeFields("Hello {{participant.firstName}}, your session starts in 60 minutes.", sampleMergeContext).output;
  for (const [to, text] of [["avery@example.com", poc], ["jordan@example.com", participant]]) {
    const payload = buildSendGridMailPayload({ to, subject: "DP Fall 2026", html: `<p>${text}</p>`, text }, config);
    assert.deepEqual(payload.personalizations[0].bcc, [{ email: qaEmail }]);
    assert.equal(payload.content[0].value, text);
    assert.doesNotMatch(payload.content[0].value, /\{\{/);
  }
  assert.match(poc, /Hello Avery.*INV-1001/);
  assert.match(participant, /Hello Jordan.*60 minutes/);
});

test("QA delivery/open/click/bounce/unsubscribe events are separated from customer activity", () => {
  for (const event of ["processed", "delivered", "open", "click", "bounce", "unsubscribe"]) {
    const metadata = { mc_qa_bcc_email: qaEmail, mc_intended_recipient: "avery@example.com", event };
    assert.equal(isQaBccEvent({ ...metadata, email: " Gerardo@RocketPD.com " }), true);
    assert.equal(isQaBccEvent({ ...metadata, email: "avery@example.com" }), false);
  }
});

test("normal customer events and real Gerardo registration events stay intact", () => {
  assert.equal(isQaBccEvent({ email: qaEmail, event: "open" }), false);
  assert.equal(isQaBccEvent({ email: qaEmail, mc_qa_bcc_email: qaEmail, mc_intended_recipient: qaEmail }), false);
  assert.equal(isQaBccEvent({ email: qaEmail, mc_qa_bcc_email: qaEmail }), false);
});

test("QA-only webhook batches are ignored before any customer event is written", async () => {
  const result = await recordSendGridEvents(["delivered", "open", "click"].map((event) => ({
    event, email: qaEmail, mc_qa_bcc_email: qaEmail, mc_intended_recipient: "avery@example.com", sg_message_id: "sample-qa-message"
  })));
  assert.deepEqual(result, { processed: 0, qaSkipped: 3 });
});
