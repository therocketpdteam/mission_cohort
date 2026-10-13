import assert from "node:assert/strict";
import test from "node:test";
import { missingSubmissionIds } from "../../src/services/jotformReconciliationService";

test("finds submissions absent from both intake events and registrations", () => {
  assert.deepEqual(
    missingSubmissionIds(["sub-1", "sub-2", "sub-3"], ["sub-1"], ["sub-2"]),
    ["sub-3"]
  );
});

test("deduplicates Jotform submissions and never marks known submissions missing", () => {
  assert.deepEqual(
    missingSubmissionIds(["sub-1", "sub-1", "sub-2", ""], ["sub-2"], []),
    ["sub-1"]
  );
});
