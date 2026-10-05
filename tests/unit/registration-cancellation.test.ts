import assert from "node:assert/strict";
import test from "node:test";
import { registrationCancellationEmail } from "../../src/config/registrationCancellation";
import { renderMergeFields, sampleMergeContext, validateMergeFields } from "../../src/modules/email";

test("registration cancellation email uses supported merge fields and renders its POC details", () => {
  const source = [
    registrationCancellationEmail.subject,
    registrationCancellationEmail.bodyHtml,
    registrationCancellationEmail.bodyText
  ].join("\n");

  assert.deepEqual(validateMergeFields(source), []);

  const subject = renderMergeFields(registrationCancellationEmail.subject, sampleMergeContext).output;
  const body = renderMergeFields(registrationCancellationEmail.bodyText, sampleMergeContext).output;
  assert.equal(subject, "Registration cancelled: Instructional Leadership Spring Cohort");
  assert.match(body, /Hello Avery,/);
  assert.match(body, /Northview School District/);
  assert.match(body, /INV-1001/);
  assert.doesNotMatch(body, /\{\{/);
});
