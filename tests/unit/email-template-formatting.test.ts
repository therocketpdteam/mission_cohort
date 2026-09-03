import assert from "node:assert/strict";
import test from "node:test";
import { renderMergeFields, sampleMergeContext, textToEmailHtml } from "../../src/modules/email";
import { buildSendGridMailPayload, normalizeSendGridApiKey } from "../../src/modules/email/sendgridProvider";
import { defaultTemplates } from "../../src/services/communicationService";

test("renders email body formatting into safe HTML", () => {
  const html = textToEmailHtml([
    "Hello **Avery**,",
    "",
    "- *First* item",
    "- {green:Confirmed}",
    "",
    "[Here is your W-9 for your convenience]({{registration.w9Url}})"
  ].join("\n"));

  assert.match(html, /<strong>Avery<\/strong>/);
  assert.match(html, /<ul><li><em>First<\/em> item<\/li><li><span style="color:#16A34A;font-weight:700;">Confirmed<\/span><\/li><\/ul>/);
  assert.match(html, /<a href="\{\{registration\.w9Url\}\}" target="_blank" rel="noopener noreferrer">Here is your W-9 for your convenience<\/a>/);
});

test("escapes raw HTML while preserving supported formatting", () => {
  const html = textToEmailHtml("<script>alert(1)</script> **safe** [bad](javascript:alert(1))");

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>safe<\/strong>/);
  assert.match(html, /href="#"/);
});

test("normalizes pasted SendGrid API keys", () => {
  assert.equal(normalizeSendGridApiKey("Bearer SG.test-key"), "SG.test-key");
  assert.equal(normalizeSendGridApiKey("\"SG.quoted-key\""), "SG.quoted-key");
  assert.equal(normalizeSendGridApiKey("   "), undefined);
});

test("builds private SendGrid personalizations for multiple recipients", () => {
  const payload = buildSendGridMailPayload({
    to: ["Gerardo@RocketPD.com", "ggrosso85@hotmail.com"],
    subject: "Test",
    html: "<p>Hello</p>",
    text: "Hello"
  }, {
    fromEmail: "info@rocketpd.com",
    fromName: "The RocketPD Team"
  });

  assert.equal(payload.personalizations.length, 2);
  assert.deepEqual(payload.personalizations.map((personalization) => personalization.to), [
    [{ email: "gerardo@rocketpd.com" }],
    [{ email: "ggrosso85@hotmail.com" }]
  ]);
});

test("builds SendGrid file attachments from resolved content", () => {
  const payload = buildSendGridMailPayload({
    to: "gerardo@rocketpd.com",
    subject: "Invoice",
    html: "<p>Hello</p>",
    attachments: [{
      content: Buffer.from("pdf-bytes").toString("base64"),
      filename: "Invoice JS-2026-355.pdf",
      type: "application/pdf",
      disposition: "attachment"
    }]
  }, {
    fromEmail: "info@rocketpd.com",
    fromName: "The RocketPD Team"
  });

  assert.deepEqual(payload.attachments, [{
    content: Buffer.from("pdf-bytes").toString("base64"),
    filename: "Invoice JS-2026-355.pdf",
    type: "application/pdf",
    disposition: "attachment"
  }]);
});

test("POC registration confirmation describes invoice and W-9 as attachments", () => {
  const template = defaultTemplates.find((item) => item.name === "POC Registration Confirmation");

  assert.ok(template);
  assert.match(template.bodyText, /Hello \{\{registration\.primaryContactFirstName\}\}/);
  assert.match(template.bodyText, /invoice and RocketPD W-9 are attached/i);
  assert.match(template.bodyText, /\{\{registration\.purchaseOrderBullet\}\}/);
  assert.match(template.bodyText, /\{\{registration\.participantRosterNextStep\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.paymentStatus\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.w9Url\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.invoiceUrl\}\}/);
  assert.doesNotMatch(template.bodyText, /If you registered a team and already shared participant information/);
});

test("payment reminder describes invoice and W-9 as attachments", () => {
  const template = defaultTemplates.find((item) => item.name === "Payment Reminder");

  assert.ok(template);
  assert.match(template.bodyText, /Hello \{\{registration\.primaryContactFirstName\}\}/);
  assert.match(template.bodyText, /I've attached the invoice and RocketPD W-9/i);
  assert.match(template.bodyText, /getting the invoice wrapped up/i);
  assert.match(template.bodyText, /business office/i);
  assert.match(template.bodyText, /Invoice sent: \{\{registration\.invoiceSentDate\}\}/);
  assert.match(template.bodyText, /Amount: \*\*\{\{registration\.totalAmount\}\}\*\*/);
  assert.match(template.bodyText, /\{\{registration\.purchaseOrderLine\}\}/);
  assert.doesNotMatch(template.bodyText, /Purchase order: \{\{registration\.purchaseOrderNumber\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.paymentStatus\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.w9Url\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.invoiceUrl\}\}/);
  assert.doesNotMatch(template.bodyText, /Hello \{\{registration\.primaryContactName\}\}/);
});

test("participant list request asks for optional titles and greets the POC by first name", () => {
  const template = defaultTemplates.find((item) => item.name === "Participant List Request");

  assert.ok(template);
  assert.match(template.bodyText, /Hello \{\{registration\.primaryContactFirstName\}\}/);
  assert.match(template.bodyText, /titles if available/i);
  assert.match(template.bodyText, /First Last, Title, email@school\.org/);
  assert.doesNotMatch(template.bodyText, /Hello \{\{registration\.primaryContactName\}\}/);
});

test("supporting documents request describes attachments and greets the POC by first name", () => {
  const template = defaultTemplates.find((item) => item.name === "Supporting Documents Request");

  assert.ok(template);
  assert.match(template.bodyText, /Hello \{\{registration\.primaryContactFirstName\}\}/);
  assert.match(template.bodyText, /invoice and RocketPD W-9 are attached/i);
  assert.match(template.bodyText, /PO number added/i);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.w9Url\}\}/);
  assert.doesNotMatch(template.bodyText, /\{\{registration\.invoiceUrl\}\}/);
  assert.doesNotMatch(template.bodyText, /Hello \{\{registration\.primaryContactName\}\}/);
});

test("session date merge fields render in the session timezone", () => {
  const result = renderMergeFields("Starts {{session.startTime}}", {
    session: {
      startTime: new Date("2026-09-24T19:30:00.000Z"),
      timezone: "America/New_York"
    }
  });

  assert.equal(result.output, "Starts September 24, 2026 at 3:30 PM Eastern Time");
  assert.deepEqual(result.warnings, []);
});

test("three weeks before cohort omits the portal profile step", () => {
  const template = defaultTemplates.find((item) => item.name === "Three Weeks Before Cohort");

  assert.ok(template);
  assert.doesNotMatch(template.bodyText, /Set up your profile on the RocketPD Learning Portal/);
  assert.match(template.bodyText, /Here are two ways you can start preparing/);
  assert.doesNotMatch(template.bodyText, /Here are three steps/);
});

test("default communication templates only use registered merge fields", () => {
  const warnings = defaultTemplates.flatMap((template) => [
    ...renderMergeFields(template.subject, sampleMergeContext, true).warnings,
    ...renderMergeFields(template.bodyText, sampleMergeContext, true).warnings
  ]);

  assert.deepEqual(warnings, []);
});
