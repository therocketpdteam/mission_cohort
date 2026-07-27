import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBulkRegistrationMove } from "../../src/services/registrationService";

test("summarizes bulk registration moves with child record counts", () => {
  const summary = summarizeBulkRegistrationMove([
    {
      id: "registration-1",
      cohortId: "source-cohort",
      participants: [{ id: "participant-1" }, { id: "participant-2" }],
      paymentRecords: [{ id: "payment-1" }],
      invoiceDrafts: [{ quickBooksInvoiceRef: null }],
      operationsTasks: [{ id: "task-1" }, { id: "task-2" }]
    },
    {
      id: "registration-2",
      cohortId: "target-cohort",
      participants: [{ id: "participant-3" }],
      paymentRecords: [],
      invoiceDrafts: [],
      operationsTasks: []
    }
  ], "target-cohort");

  assert.equal(summary.requestedCount, 2);
  assert.equal(summary.movedCount, 1);
  assert.equal(summary.skippedAlreadyInTargetCount, 1);
  assert.equal(summary.participantCount, 2);
  assert.equal(summary.paymentRecordCount, 1);
  assert.equal(summary.invoiceDraftCount, 1);
  assert.equal(summary.operationsTaskCount, 2);
  assert.deepEqual(summary.sourceCohortIds, ["source-cohort"]);
});

test("flags moved registrations with QuickBooks references", () => {
  const summary = summarizeBulkRegistrationMove([
    {
      id: "registration-1",
      cohortId: "source-cohort",
      participants: [],
      paymentRecords: [],
      invoiceDrafts: [{ quickBooksInvoiceRef: "qb-invoice-1" }],
      operationsTasks: []
    },
    {
      id: "registration-2",
      cohortId: "source-cohort",
      quickBooksCustomerRef: "qb-customer-1",
      participants: [],
      paymentRecords: [],
      invoiceDrafts: [],
      operationsTasks: []
    },
    {
      id: "registration-3",
      cohortId: "target-cohort",
      quickBooksInvoiceRef: "already-target",
      participants: [],
      paymentRecords: [],
      invoiceDrafts: [],
      operationsTasks: []
    }
  ], "target-cohort");

  assert.equal(summary.quickBooksWarningCount, 2);
});
