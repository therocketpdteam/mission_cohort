import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import {
  historicalCohortBaseSlug,
  normalizeHistoricalImportRows,
  suggestHistoricalImportMapping
} from "../../src/services/historicalImportService";

const csv = [
  "Cohort,Short Name,Presenter,Start Date,Organization,City,State,ZIP,POC Name,Email,Participant Count,Participant Names,Participant Emails,Participant Titles,Amount,Payment Status,Payment Method,Source,Session Dates",
  "Building Thinking Classrooms,PL-Fall-2025,Peter Liljedahl,9/10/2025,Rapid City Schools,Rapid City,South Dakota,57701,Kim Sender,kim@example.com,2,\"Ada Lovelace;Grace Hopper\",\"ada@example.com;grace@example.com\",\"Coach;Principal\",\"$1,590\",Paid,Purchase Order,website,\"9/10/2025;9/17/2025\"",
  "Building Thinking Classrooms,PL-Fall-2025,Peter Liljedahl,9/10/2025,Rapid City Schools,Rapid City,SD,57701,Kim Sender,kim@example.com,2,\"Alan Turing\",,\"Teacher\",795,,Credit Card,instantly,",
  "Building Thinking Classrooms,PL-Fall-2025,Peter Liljedahl,9/10/2025,Rapid City Schools,Rapid City,South Dakota,57701,Kim Sender,kim@example.com,2,\"Ada Lovelace;Grace Hopper\",\"ada@example.com;grace@example.com\",\"Coach;Principal\",\"$1,590\",Paid,Purchase Order,website,\"9/10/2025;9/17/2025\""
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

test("uses cohort short code as the historical cohort slug without appending the year twice", () => {
  assert.equal(historicalCohortBaseSlug({
    cohortTitle: "Rethinking teacher supervision, coaching & evaluation",
    cohortShortName: "KM-Fall-2025"
  }, new Date("2025-09-24T19:30:00.000Z")), "km-fall-2025");

  assert.equal(historicalCohortBaseSlug({
    cohortTitle: "Rethinking teacher supervision, coaching & evaluation"
  }, new Date("2026-09-24T19:30:00.000Z")), "rethinking-teacher-supervision-coaching-evaluation-2026");
});

test("normalizes historical CSV rows with paid defaults, state codes, sessions, and duplicate warnings", () => {
  const preview = normalizeHistoricalImportRows(csv);
  const first = preview.rows[0].normalized;
  const second = preview.rows[1];

  const third = preview.rows[2];

  assert.equal(preview.summary.totalRows, 3);
  assert.equal(preview.summary.validRows, 3);
  assert.equal(preview.summary.warningRows, 2);
  assert.equal(first.paymentStatus, PaymentStatus.PAID);
  assert.equal(first.paymentMethod, PaymentMethod.PURCHASE_ORDER);
  assert.equal(first.organizationState, "SD");
  assert.equal(first.totalAmount, 1590);
  assert.equal(first.participants.length, 2);
  assert.equal(first.participants[0].title, "Coach");
  assert.equal(first.sessionDates.length, 2);
  assert.equal(second.normalized.paymentStatus, PaymentStatus.PAID);
  assert.equal(second.normalized.paymentMethod, PaymentMethod.CREDIT_CARD);
  assert.match(second.warnings.join(" "), /participant emails/);
  assert.match(third.warnings.join(" "), /Possible duplicate/);
});

test("keeps invalid historical rows out of the importable preview", () => {
  const preview = normalizeHistoricalImportRows("Cohort,Presenter,Organization,Email\n,,Rocket School,broken@example.com");

  assert.equal(preview.summary.validRows, 0);
  assert.equal(preview.summary.errorRows, 1);
  assert.match(preview.rows[0].errors.join(" "), /Cohort title/);
  assert.match(preview.rows[0].errors.join(" "), /Presenter/);
  assert.match(preview.rows[0].errors.join(" "), /POC name/);
});

test("groups single-cohort roster CSV rows into registrations with the first row as POC", () => {
  const groupedCsv = [
    "Key,District,Address,City,State,Zip,Primary contact,Name,,Email,Phone,Participants,Amount,Adtnl. team,Total,Status,# Participants,Add Participants,POC,Date,Invoice #,Notes",
    ",Cesa 3,1300 Industrial Drive,Fennimore,WI,53809,X,Ellie Olson,,eolson@cesa3.org,(608) 379-2218,3,,,\"$2,385\",Paid,,,,3/25/2025,KM-244,Check no. 00062222",
    ",Cesa 3,,,,,,Lisa Arneson,,larneson@cesa3.org,,,,,,,,,,,,",
    ",Cesa 3,,,,,,Laura Veglahn,,lveglahn@cesa4.k12.wi.us,,,,,,,,,,,,",
    ",St. George School,Po Box 153,Tenants Harbor,ME,4860,X,Jessica Mcgreevy,,j.mcgreevy@stgeorgemsu.org,(207) 372-6312,1,,,$795,Paid,,,,3/31/2025,KM-246,Check no. 010693"
  ].join("\n");
  const preview = normalizeHistoricalImportRows(groupedCsv, undefined, {
    title: "Rethinking teacher supervision, coaching & evaluation",
    presenterName: "Kim Marshall",
    presenterShortName: "KM",
    startDate: "2025-09-01",
    endDate: "2025-12-01",
    season: "Fall"
  });

  assert.equal("mode" in preview ? preview.mode : "", "single_cohort_grouped");
  assert.equal(preview.summary.validRows, 2);
  assert.equal(preview.rows[0].normalized.cohortShortName, "KM-Fall-2025");
  assert.equal(preview.rows[0].normalized.organizationName, "Cesa 3");
  assert.equal(preview.rows[0].normalized.primaryContactName, "Ellie Olson");
  assert.equal(preview.rows[0].normalized.primaryContactEmail, "eolson@cesa3.org");
  assert.equal(preview.rows[0].normalized.participants.length, 3);
  assert.equal(preview.rows[0].normalized.participantCount, 3);
  assert.equal(preview.rows[0].normalized.totalAmount, 2385);
  assert.equal(preview.rows[0].normalized.paymentMethod, PaymentMethod.INVOICE);
  assert.equal(preview.rows[1].normalized.organizationState, "ME");
  assert.equal(preview.supportedFields.some((field) => field.field === "cohortTitle"), false);
});

test("excludes POC-only rows from participants while preserving the registration contact and date", () => {
  const headers = [
    "Key",
    "District",
    "Address",
    "City",
    "State",
    "Zip",
    "Primary contact",
    "Name",
    "Title",
    "Email",
    "Phone",
    "Participants",
    "Amount",
    "Adtnl. team",
    "Total",
    "Status",
    "# Participants",
    "Add Participants",
    "POC",
    "Date",
    "Invoice #",
    "Notes"
  ];
  const csvRow = (cells: string[]) => headers.map((_, index) => cells[index] ?? "").join(",");
  const groupedCsv = [
    headers.join(","),
    csvRow(["abc", "San Benito High School District", "1220 Monterey St", "Hollister", "CA", "95023", "X", "Donna Wilkinson", "Admin", "dwilkinson@example.edu", "831-555-0100", "2", "", "", "$990", "Paid", "", "", "X", "9/26/2025", "JG-113", "Ignore me"]),
    csvRow(["", "San Benito High School District", "", "", "", "", "", "Carissa Carsey", "Teacher", "ccarsey@example.edu"]),
    csvRow(["", "San Benito High School District", "", "", "", "", "", "Allison Musich", "Teacher", "amusich@example.edu"]),
    csvRow(["def", "Campbell Hall", "4533 Laurel Canyon Blvd", "Studio City", "CA", "91607", "X", "Carolyn Lagaly", "Admin", "lagalyc@example.edu", "", "1", "", "", "$495", "Refunded", "", "", "X", "8/6/2025", "JG-46", "Refunded"])
  ].join("\n");
  const preview = normalizeHistoricalImportRows(groupedCsv, { notes: "" }, {
    title: "Build teaching confidence with powerful lesson design",
    shortName: "JG-Fall-2025",
    presenterName: "Jennifer Gonzalez",
    presenterEmail: "gonzjenn@gmail.com",
    presenterShortName: "JG",
    startDate: "3/3/2026",
    endDate: "3/31/2026",
    season: "Fall"
  });

  assert.equal(preview.summary.totalRows, 2);
  assert.equal(preview.summary.validRows, 2);
  assert.equal(preview.summary.warningRows, 0);
  assert.equal(preview.summary.cohorts[0]?.participants, 2);
  assert.equal(preview.mapping.purchaseOrderNumber, undefined);
  assert.equal(preview.rows[0].normalized.cohortShortName, "JG-Fall-2025");
  assert.equal(preview.rows[0].normalized.primaryContactName, "Donna Wilkinson");
  assert.equal(preview.rows[0].normalized.primaryContactEmail, "dwilkinson@example.edu");
  assert.equal(preview.rows[0].normalized.participantCount, 2);
  assert.equal(preview.rows[0].normalized.participants.length, 2);
  assert.equal(preview.rows[0].normalized.participants[0].email, "ccarsey@example.edu");
  assert.equal(preview.rows[0].normalized.registrationDate, "2025-09-26T15:00:00.000Z");
  assert.equal(preview.rows[0].normalized.notes, undefined);
  assert.equal(preview.rows[1].normalized.primaryContactName, "Carolyn Lagaly");
  assert.equal(preview.rows[1].normalized.paymentStatus, PaymentStatus.REFUNDED);
  assert.equal(preview.rows[1].normalized.participantCount, 1);
  assert.equal(preview.rows[1].normalized.participants.length, 0);
  assert.equal(preview.rows[1].normalized.registrationDate, "2025-08-06T15:00:00.000Z");
});
