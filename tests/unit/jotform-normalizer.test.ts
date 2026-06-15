import assert from "node:assert/strict";
import test from "node:test";
import { PaymentStatus } from "@prisma/client";
import {
  normalizeJotformRegistrationPayload,
  parseParticipantCsvText,
  previewJotformRegistrationPayload
} from "../../src/modules/jotform/normalizer";

const urlMapping = {
  id: "mapping-1",
  formId: "12345",
  label: "Shared intake",
  sessionCount: 5,
  defaultCohortId: null,
  requireCohortSlug: false,
  fieldMapJson: {
    formId: "formID",
    submissionId: "submissionID",
    primaryContactName: "Name",
    primaryContactEmail: "Email",
    organizationName: "Name of Organization",
    organizationCity: "Organization City",
    organizationState: "Organization State",
    participantCount: "How many participants will be joining?",
    paymentStatus: "Payment Status",
    totalAmount: "Total Cost",
    landingPageUrl: "Get Page URL",
    participantText: "Participant Roster",
    __landingPageRoutes: JSON.stringify([
      {
        pattern: "rocketpd.com/cohorts/summer-leadership",
        cohortId: "cohort-1",
        label: "Summer Leadership"
      }
    ])
  },
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
} as any;

test("normalizes a URL-routed Jotform registration with explicit payment status", () => {
  const normalized = normalizeJotformRegistrationPayload(
    {
      formID: "12345",
      submissionID: "sub-1",
      Name: "Jane District",
      Email: "jane@example.com",
      "Name of Organization": "Rocket District",
      "Organization City": "Rapid City",
      "Organization State": "South Dakota",
      "How many participants will be joining?": "2",
      "Payment Status": "successful",
      "Total Cost": "$1,250.00",
      "Get Page URL": "https://www.rocketpd.com/cohorts/summer-leadership?utm_source=newsletter",
      "Participant Roster": "Ada Lovelace, ada@example.com\nGrace Hopper, grace@example.com"
    },
    [urlMapping]
  );

  assert.equal(normalized.routing.cohortId, "cohort-1");
  assert.equal(normalized.routing.mappingId, "mapping-1");
  assert.equal(normalized.registration.paymentStatus, PaymentStatus.PAID);
  assert.equal(normalized.registration.totalAmount, 1250);
  assert.equal(normalized.organization.city, "Rapid City");
  assert.equal(normalized.organization.state, "South Dakota");
  assert.equal(normalized.registration.utmSource, "newsletter");
  assert.equal(normalized.participants.length, 2);
});

test("previews unmapped forms as needing mapping while hiding noisy fields", () => {
  const preview = previewJotformRegistrationPayload({
    formID: "unmapped",
    submissionID: "sub-2",
    Name: "Jane District",
    Email: "jane@example.com",
    rawRequest: JSON.stringify({ pretty: "Hidden Tracker: noisy" }),
    paymentFieldsToSelectedProducts: "internal",
    customParams: "internal"
  });

  assert.equal(preview.hasMapping, false);
  assert.equal(preview.formId, "unmapped");
  assert.equal(preview.fieldOptions.some((option: any) => option.key === "paymentFieldsToSelectedProducts"), false);
  assert.equal(preview.fieldOptions.some((option: any) => option.key === "customParams"), false);
});

test("parses valid participants and reports roster line errors", () => {
  const result = parseParticipantCsvText("Ada Lovelace, ada@example.com\nBroken Person\nGrace Hopper grace@example.com");

  assert.equal(result.participants.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Line 2/);
});

test("maps common Jotform payment status values explicitly", () => {
  const normalized = normalizeJotformRegistrationPayload(
    {
      formID: "12345",
      submissionID: "sub-3",
      Name: "Jane District",
      Email: "jane@example.com",
      "Name of Organization": "Rocket District",
      "How many participants will be joining?": "1",
      "Payment Status": "invoice pending",
      "Total Cost": "500",
      "Get Page URL": "https://rocketpd.com/cohorts/summer-leadership"
    },
    [urlMapping]
  );

  assert.equal(normalized.registration.paymentStatus, PaymentStatus.INVOICED);
});

test("uses the only URL route when Jotform sends a generic landing page", () => {
  const normalized = normalizeJotformRegistrationPayload(
    {
      formID: "12345",
      submissionID: "sub-4",
      Name: "Jane District",
      Email: "jane@example.com",
      "Name of Organization": "Rocket District",
      "How many participants will be joining?": "1",
      "Total Cost": "795",
      "Get Page URL": "https://rocketpd.com/"
    },
    [urlMapping]
  );

  assert.equal(normalized.routing.cohortId, "cohort-1");
  assert.equal(normalized.registration.cohortId, "cohort-1");
});

test("defaults one-person no-roster Jotform registrations to the primary contact participant", () => {
  const normalized = normalizeJotformRegistrationPayload(
    {
      formID: "12345",
      submissionID: "sub-single",
      Name: "Natashia Michael",
      Email: "natashia.michael@fayar.net",
      "Name of Organization": "Fayetteville Public Schools",
      "Total Cost": "495",
      "Get Page URL": "https://rocketpd.com/cohorts/summer-leadership"
    },
    [urlMapping]
  );

  assert.equal(normalized.registration.participantCount, 1);
  assert.equal(normalized.participants.length, 1);
  assert.equal(normalized.participants[0].firstName, "Natashia");
  assert.equal(normalized.participants[0].lastName, "Michael");
  assert.equal(normalized.participants[0].email, "natashia.michael@fayar.net");
});

test("keeps multi-person no-roster Jotform registrations open for roster follow-up", () => {
  const normalized = normalizeJotformRegistrationPayload(
    {
      formID: "12345",
      submissionID: "sub-multi",
      Name: "Kay Farmer",
      Email: "kfarmer@vbisd.org",
      "Name of Organization": "Van Buren ISD",
      "How many participants will be joining?": "3",
      "Total Cost": "1485",
      "Get Page URL": "https://rocketpd.com/cohorts/summer-leadership"
    },
    [urlMapping]
  );

  assert.equal(normalized.registration.participantCount, 3);
  assert.equal(normalized.participants.length, 0);
});
