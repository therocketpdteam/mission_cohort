import assert from "node:assert/strict";
import test from "node:test";
import { renderMergeFields, sampleMergeContext, textToEmailHtml } from "../../src/modules/email";
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

test("default communication templates only use registered merge fields", () => {
  const warnings = defaultTemplates.flatMap((template) => [
    ...renderMergeFields(template.subject, sampleMergeContext, true).warnings,
    ...renderMergeFields(template.bodyText, sampleMergeContext, true).warnings
  ]);

  assert.deepEqual(warnings, []);
});
