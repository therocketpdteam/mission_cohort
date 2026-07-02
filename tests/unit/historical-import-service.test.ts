import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import {
  normalizeHistoricalImportRows,
  suggestHistoricalImportMapping
} from "../../src/services/historicalImportService";

const csv = [
  "Cohort,Short Name,Presenter,Start Date,Organization,City,State,ZIP,POC Name,Email,Participant Count,Participant Names,Participant Emails,Participant Titles,Amount,Payment Status,Payment Method,Source,Session Dates",
  "Building Thinking Classrooms,PL-Fall-2025,Peter Liljedahl,9/10/2025,Rapid City Schools,Rapid City,South Dakota,57701,Kim Sender,kim@example.com,2,\"Ada Lovelace;Grace Hopper\",\"ada@example.com;grace@example.com\",\"Coach;Principal\",\"$1,590\",Paid,Purchase Order,website,\"9/10/2025;9/17/2025\"",
  "Building Thinking Classrooms,PL-Fall-2025,Peter Liljedahl,9/10/2025,Rapid City Schools,Rapid City,SD,57701,Kim Sender,kim@example.com,2,\"Alan Turing\",,\"Teacher\",795,,Credit Card,instantly,"
].join("\n");

test("suggests historical import mappings from friendly CSV headers", () => {
  const mapping = suggestHistoricalImportMapping(["Cohort", "Presenter", "POC Name", "Email", "Participant Count", "Amount"]);

  assert.equal(mapping.cohortTitle, "Cohort");
  assert.equal(mapping.presenterName, "Presenter");
  assert.equal(mapping.primaryContactName, "POC Name");
  assert.equal(mapping.primaryContactEmail, "Email");
  assert.equal(mapping.participantCount, "Participant Count");
  assert.equal(mapping.totalAmount, "Amount");
});

test("normalizes historical CSV rows with paid defaults, state codes, sessions, and duplicate warnings", () => {
  const preview = normalizeHistoricalImportRows(csv);
  const first = preview.rows[0].normalized;
  const second = preview.rows[1];

  assert.equal(preview.summary.totalRows, 2);
  assert.equal(preview.summary.validRows, 2);
  assert.equal(preview.summary.warningRows, 1);
  assert.equal(first.paymentStatus, PaymentStatus.PAID);
  assert.equal(first.paymentMethod, PaymentMethod.PURCHASE_ORDER);
  assert.equal(first.organizationState, "SD");
  assert.equal(first.totalAmount, 1590);
  assert.equal(first.participants.length, 2);
  assert.equal(first.participants[0].title, "Coach");
  assert.equal(first.sessionDates.length, 2);
  assert.equal(second.normalized.paymentStatus, PaymentStatus.PAID);
  assert.equal(second.normalized.paymentMethod, PaymentMethod.CREDIT_CARD);
  assert.match(second.warnings.join(" "), /Possible duplicate/);
  assert.match(second.warnings.join(" "), /participant emails/);
});

test("keeps invalid historical rows out of the importable preview", () => {
  const preview = normalizeHistoricalImportRows("Cohort,Presenter,Organization,Email\n,,Rocket School,broken@example.com");

  assert.equal(preview.summary.validRows, 0);
  assert.equal(preview.summary.errorRows, 1);
  assert.match(preview.rows[0].errors.join(" "), /Cohort title/);
  assert.match(preview.rows[0].errors.join(" "), /Presenter/);
  assert.match(preview.rows[0].errors.join(" "), /POC name/);
});
