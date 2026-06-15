import { OrganizationType, PaymentMethod, PaymentStatus, RegistrationStatus } from "@prisma/client";
import type { JotformFormMapping } from "@prisma/client";

type UnknownRecord = Record<string, unknown>;
type ParsedParticipant = {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  phone?: string;
};
type FieldMap = Record<string, string>;
type LandingPageRoute = {
  pattern: string;
  cohortId: string;
  label?: string;
};
type JotformTargetField = {
  target: string;
  label: string;
  category: string;
  aliases: string[];
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailInTextPattern = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/;

export const jotformTargetFields: JotformTargetField[] = [
  { target: "formId", label: "Jotform form ID", category: "Form", aliases: ["formID", "formId", "form_id", "form ID"] },
  { target: "submissionId", label: "Submission ID", category: "Form", aliases: ["submissionID", "submissionId", "submission_id", "id"] },
  { target: "cohortSlug", label: "Cohort slug", category: "Routing", aliases: ["cohortSlug", "cohort_slug", "CohortSlug"] },
  { target: "primaryContactName", label: "POC full name", category: "Contact", aliases: ["primaryContactName", "contactName", "registrantName", "fullName", "Name", "q7_name", "name"] },
  { target: "primaryContactFirstName", label: "POC first name", category: "Contact", aliases: ["primaryContactFirstName", "contactFirstName", "registrantFirstName", "firstName", "First Name", "first"] },
  { target: "primaryContactLastName", label: "POC last name", category: "Contact", aliases: ["primaryContactLastName", "contactLastName", "registrantLastName", "lastName", "Last Name", "last"] },
  { target: "primaryContactEmail", label: "POC email", category: "Contact", aliases: ["primaryContactEmail", "contactEmail", "registrantEmail", "Email", "q12_email", "email"] },
  { target: "primaryContactPhone", label: "POC phone", category: "Contact", aliases: ["primaryContactPhone", "contactPhone", "registrantPhone", "Phone Number", "q13_billTo13", "phone"] },
  { target: "primaryContactTitle", label: "POC title", category: "Contact", aliases: ["primaryContactTitle", "contactTitle", "Title", "q63_title", "title"] },
  { target: "organizationName", label: "Organization name", category: "Organization", aliases: ["Name of Organization", "q15_nameOf", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName"] },
  { target: "organizationAddress", label: "Organization address", category: "Organization", aliases: ["billingAddress", "address", "Address"] },
  { target: "organizationCity", label: "Organization city", category: "Organization", aliases: ["organizationCity", "districtCity", "schoolCity", "city", "City"] },
  { target: "organizationState", label: "Organization state", category: "Organization", aliases: ["organizationState", "districtState", "schoolState", "state", "State"] },
  { target: "organizationPhone", label: "Organization phone", category: "Organization", aliases: ["organizationPhone", "phone", "Phone", "Phone Number"] },
  { target: "participantCount", label: "Participant count", category: "Registration", aliases: ["participantCount", "How many participants will be joining?", "Please select how many participants will be joining?", "q20_howMany", "numberOfParticipants", "participantsCount"] },
  { target: "paymentMethod", label: "Payment method", category: "Payment", aliases: ["paymentMethod", "Preferred method of payment?", "q46_preferredMethod", "method"] },
  { target: "paymentStatus", label: "Payment status", category: "Payment", aliases: ["paymentStatus", "status"] },
  { target: "totalAmount", label: "Total amount", category: "Payment", aliases: ["totalAmount", "Total Cost", "CC - Total", "q56_totalCost56", "amount", "total"] },
  { target: "purchaseOrderNumber", label: "PO number", category: "Payment", aliases: ["purchaseOrderNumber", "poNumber", "purchaseOrder"] },
  { target: "invoiceNumber", label: "Invoice number", category: "Payment", aliases: ["invoiceNumber", "invoice"] },
  { target: "notes", label: "Notes/source", category: "Registration", aliases: ["notes", "additionalNotes", "How did you hear about us?"] },
  { target: "utmSource", label: "UTM source", category: "Source", aliases: ["utm_source", "utmSource", "UTM Source"] },
  { target: "utmMedium", label: "UTM medium", category: "Source", aliases: ["utm_medium", "utmMedium", "UTM Medium"] },
  { target: "utmCampaign", label: "UTM campaign", category: "Source", aliases: ["utm_campaign", "utmCampaign", "UTM Campaign"] },
  { target: "utmContent", label: "UTM content", category: "Source", aliases: ["utm_content", "utmContent", "UTM Content"] },
  { target: "utmTerm", label: "UTM term", category: "Source", aliases: ["utm_term", "utmTerm", "UTM Term"] },
  { target: "landingPageUrl", label: "Landing page URL", category: "Source", aliases: ["landingPageUrl", "landing_page_url", "Get Page URL", "lead_source", "q25_leadSource", "q59_typeA59"] },
  { target: "referrerUrl", label: "Referrer URL", category: "Source", aliases: ["referrerUrl", "referrer", "Referrer"] },
  { target: "participantText", label: "Participant names/emails text box", category: "Participants", aliases: ["participantCsv", "participantsCsv", "participantText", "participantNamesEmails", "participantNamesAndEmails", "teamParticipants", "TeamParticipants", "namesAndEmails", "NamesEmails", "Please enter the names and email addresses of all participants, one per line, in the following format: Full Name, Email"] }
];

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean).join(", ");
  }

  if (value && typeof value === "object") {
    const record = value as UnknownRecord;
    const firstName = readString(record.first ?? record.firstName);
    const lastName = readString(record.last ?? record.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    if (fullName) {
      return fullName;
    }

    return readString(record.full ?? record.prettyFormat ?? record.answer ?? record.value ?? "");
  }

  return "";
}

function readNumber(value: unknown): number {
  const string = readString(value);
  const normalized = string.replace(/[^0-9.-]+/g, "");
  const number = Number(normalized || value);
  return Number.isFinite(number) ? number : 0;
}

function readParticipantCount(value: unknown): number {
  const string = readString(value);
  const specialQuantity = string.match(/special\s+quantity:\s*(\d+)/i);

  if (specialQuantity?.[1]) {
    return Number(specialQuantity[1]);
  }

  return readNumber(value);
}

function firstUrlFromText(value: unknown): string {
  const text = readString(value);
  const match = text.match(/https?:\/\/[^\s,'"]+/i);
  return match?.[0] ?? "";
}

function readUrlSearchParam(value: unknown, param: string): string {
  const rawUrl = firstUrlFromText(value) || readString(value);

  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(rawUrl).searchParams.get(param) ?? "";
  } catch {
    return "";
  }
}

function readUtmValue(flat: UnknownRecord, fieldMap: FieldMap, target: string, aliases: string[], sourceUrls: unknown[]): string {
  const direct = readString(mappedFirstValue(flat, flat, fieldMap, target, aliases));

  if (direct) {
    return direct;
  }

  const paramName = target.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).toLowerCase();

  for (const sourceUrl of sourceUrls) {
    const value = readUrlSearchParam(sourceUrl, paramName);

    if (value) {
      return value;
    }
  }

  return "";
}

function readPaymentMethod(value: unknown): PaymentMethod {
  const normalized = normalizeKey(readString(value));

  if (["creditcard", "card", "stripe"].includes(normalized)) {
    return PaymentMethod.CREDIT_CARD;
  }

  if (["invoicepo", "invoicepurchaseorder", "purchaseorder", "po"].includes(normalized)) {
    return PaymentMethod.INVOICE;
  }

  return readEnumValue(PaymentMethod, value, PaymentMethod.UNKNOWN);
}

function readPaymentStatus(value: unknown, fallback: PaymentStatus) {
  const normalized = normalizeKey(readString(value));

  if (["paid", "paymentcomplete", "completed", "complete", "success", "successful", "charged", "captured"].includes(normalized)) {
    return PaymentStatus.PAID;
  }

  if (["partial", "partiallypaid", "deposit"].includes(normalized)) {
    return PaymentStatus.PARTIALLY_PAID;
  }

  if (["invoice", "invoiced", "invoicepending", "po", "purchaseorder"].includes(normalized)) {
    return PaymentStatus.INVOICED;
  }

  if (["cancelled", "canceled", "void", "voided"].includes(normalized)) {
    return PaymentStatus.CANCELLED;
  }

  if (["refunded", "refund"].includes(normalized)) {
    return PaymentStatus.REFUNDED;
  }

  if (["pending", "awaitingpayment", "unpaid", "open"].includes(normalized)) {
    return PaymentStatus.PENDING;
  }

  return readEnumValue(PaymentStatus, value, fallback);
}

function readEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown, fallback: T[keyof T]): T[keyof T] {
  const normalized = normalizeKey(readString(value));
  const match = Object.values(enumValues).find((item) => normalizeKey(item) === normalized);
  return (match ?? fallback) as T[keyof T];
}

function firstValue(payload: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    const direct = payload[key];

    if (direct != null && readString(direct)) {
      return direct;
    }

    const normalizedKey = normalizeKey(key);
    const caseInsensitiveKey = Object.keys(payload).find((candidate) => normalizeKey(candidate) === normalizedKey);
    const caseInsensitiveValue = caseInsensitiveKey ? payload[caseInsensitiveKey] : undefined;

    if (caseInsensitiveValue != null && readString(caseInsensitiveValue)) {
      return caseInsensitiveValue;
    }
  }

  return undefined;
}

function readFieldMap(mapping?: JotformFormMapping): FieldMap {
  const value = mapping?.fieldMapJson;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as UnknownRecord).reduce<FieldMap>((acc, [target, sourceKey]) => {
    const key = readString(sourceKey);

    if (key) {
      acc[target] = key;
    }

    return acc;
  }, {});
}

function readLandingPageRoutes(mapping?: JotformFormMapping): LandingPageRoute[] {
  const fieldMap = mapping?.fieldMapJson;
  let value: unknown[] = [];

  if (fieldMap && typeof fieldMap === "object" && !Array.isArray(fieldMap)) {
    try {
      const parsed = JSON.parse(readString((fieldMap as Record<string, unknown>).__landingPageRoutes) || "[]");
      value = Array.isArray(parsed) ? parsed : [];
    } catch {
      value = [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((route) => {
      const row = route && typeof route === "object" && !Array.isArray(route) ? route as Record<string, unknown> : {};
      return {
        pattern: readString(row.pattern),
        cohortId: readString(row.cohortId),
        label: readString(row.label)
      };
    })
    .filter((route) => route.pattern && route.cohortId);
}

function normalizeUrlForMatch(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function landingPageMatchesPattern(landingPageUrl: string, pattern: string) {
  const normalizedUrl = normalizeUrlForMatch(landingPageUrl);
  const normalizedPattern = normalizeUrlForMatch(pattern);

  if (!normalizedUrl || !normalizedPattern) {
    return false;
  }

  if (normalizedUrl === normalizedPattern || normalizedUrl.includes(normalizedPattern)) {
    return true;
  }

  try {
    const url = new URL(normalizedUrl);
    const patternUrl = new URL(normalizedPattern);
    return url.hostname === patternUrl.hostname && normalizeUrlForMatch(url.pathname) === normalizeUrlForMatch(patternUrl.pathname);
  } catch {
    return false;
  }
}

function resolveLandingPageRoute(mapping: JotformFormMapping | undefined, landingPageUrl: string) {
  const routes = readLandingPageRoutes(mapping);
  const matchedRoute = routes.find((route) => landingPageMatchesPattern(landingPageUrl, route.pattern));

  if (matchedRoute) {
    return matchedRoute;
  }

  return routes.length === 1 ? routes[0] : undefined;
}

function mappedFirstValue(flat: UnknownRecord, source: UnknownRecord, fieldMap: FieldMap, target: string, fallbackKeys: string[]): unknown {
  const mappedKey = readString(fieldMap[target]);
  const mappedValue = mappedKey ? firstValue(flat, [mappedKey]) : undefined;

  if (mappedValue != null && readString(mappedValue)) {
    return mappedValue;
  }

  return firstValue(source, fallbackKeys);
}

function findSuggestedFieldKey(flat: UnknownRecord, target: JotformTargetField): string {
  for (const alias of target.aliases) {
    const directValue = flat[alias];

    if (directValue != null && readString(directValue)) {
      return alias;
    }

    const normalizedAlias = normalizeKey(alias);
    const key = Object.keys(flat).find((candidate) => normalizeKey(candidate) === normalizedAlias && readString(flat[candidate]));

    if (key) {
      return key;
    }
  }

  return "";
}

function humanizeFieldKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlyJotformFieldLabel(key: string, value: unknown): string {
  const normalizedKey = normalizeKey(key);
  const sample = readString(value);

  if (normalizedKey.includes("email") || emailPattern.test(sample)) {
    return "Email";
  }

  if (normalizedKey.includes("firstname")) {
    return "First name";
  }

  if (normalizedKey.includes("lastname")) {
    return "Last name";
  }

  if (normalizedKey.includes("name") && normalizedKey.includes("organization")) {
    return "Name of organization";
  }

  if (normalizedKey.includes("name")) {
    return "Name";
  }

  if (normalizedKey.includes("howmany") || normalizedKey.includes("participantcount") || normalizedKey.includes("quantity")) {
    return "Participant count";
  }

  if (normalizedKey.includes("preferredmethod") || normalizedKey.includes("paymentmethod")) {
    return "Payment method";
  }

  if (normalizedKey.includes("totalcost") || normalizedKey.includes("total") || normalizedKey.includes("amount")) {
    return "Total amount";
  }

  if (normalizedKey.includes("leadsource") || normalizedKey.includes("source")) {
    return "Lead source";
  }

  if (normalizedKey.includes("participant") || normalizedKey.includes("namesemails")) {
    return "Participant roster text";
  }

  if (normalizedKey === "formid") {
    return "Form ID";
  }

  if (normalizedKey === "submissionid") {
    return "Submission ID";
  }

  return humanizeFieldKey(key);
}

function isNoisyJotformField(key: string, value: unknown): boolean {
  const normalizedKey = normalizeKey(key);
  const stringValue = readString(value);

  if (["rawrequest", "jsexecutiontracker", "paymentfieldstoselectedproducts", "selectedproductslist", "builddate", "eventid", "eventobserver", "eventobserverpayment", "hiddenpaymentfield", "username", "submitdate", "submitsource", "uploadserverurl", "documentid", "customparams", "custombody", "customtitle"].includes(normalizedKey)) {
    return true;
  }

  if (normalizedKey.includes("eventobserver") || normalizedKey === "ip" || normalizedKey === "path" || normalizedKey === "slug") {
    return true;
  }

  return normalizedKey.includes("summary") && stringValue.trim().startsWith("{");
}

function optionRank(key: string) {
  const normalizedKey = normalizeKey(key);

  if (!/^q\d+/i.test(key) && !normalizedKey.includes("id")) {
    return 0;
  }

  if (/^q\d+/i.test(key)) {
    return 1;
  }

  return 2;
}

function parseJsonObject(value: unknown): UnknownRecord {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as UnknownRecord) : {};
  } catch {
    return {};
  }
}

function parsePrettyFields(value: unknown): UnknownRecord {
  const pretty = readString(value);

  if (!pretty) {
    return {};
  }

  return pretty
    .split(/,\s+(?=[^:,]{1,90}:)/)
    .reduce<UnknownRecord>((acc, part) => {
      const separatorIndex = part.indexOf(":");

      if (separatorIndex <= 0) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const fieldValue = part.slice(separatorIndex + 1).trim();

      if (key && fieldValue && acc[key] == null) {
        acc[key] = fieldValue;
      }

      return acc;
    }, {});
}

function normalizeAnswers(payload: UnknownRecord): UnknownRecord {
  const answers = payload.answers;

  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return {};
  }

  return Object.entries(answers as Record<string, UnknownRecord>).reduce<UnknownRecord>((acc, [qid, answer]) => {
    const name = readString(answer.name ?? answer.text).replace(/[^a-z0-9]+/gi, "");
    const value = answer.answer ?? answer.prettyFormat ?? answer.text;

    if (name) {
      acc[name] = value;
    }

    if (qid) {
      acc[qid] = value;
    }

    return acc;
  }, {});
}

function normalizeFlatPayload(payload: UnknownRecord): UnknownRecord {
  const rawRequest = parseJsonObject(payload.rawRequest);
  return {
    ...rawRequest,
    ...parsePrettyFields(rawRequest.pretty),
    ...parsePrettyFields(payload.pretty),
    ...normalizeAnswers(rawRequest),
    ...normalizeAnswers(payload),
    ...payload
  };
}

function normalizeParticipants(input: unknown): ParsedParticipant[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((participant) => {
    const row = participant && typeof participant === "object" ? (participant as UnknownRecord) : {};
    const fullName = readString(firstValue(row, ["name", "fullName", "participantName"]));
    const [firstNameFromFull = "", ...lastNamePartsFromFull] = fullName.split(/\s+/);

    return {
      firstName: readString(firstValue(row, ["firstName", "first_name", "FirstName"])) || firstNameFromFull,
      lastName: readString(firstValue(row, ["lastName", "last_name", "LastName"])) || lastNamePartsFromFull.join(" "),
      email: readString(firstValue(row, ["email", "Email"])),
      title: readString(firstValue(row, ["title", "Title"])),
      phone: readString(firstValue(row, ["phone", "Phone"]))
    };
  });
}

export function parseParticipantCsvText(text: unknown): { participants: ParsedParticipant[]; errors: string[] } {
  const rawText = readString(text);

  if (!emailInTextPattern.test(rawText)) {
    return { participants: [], errors: [] };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const participants: Array<{ firstName: string; lastName: string; email: string }> = [];
  const errors: string[] = [];

  for (const [index, line] of lines.entries()) {
    const emailMatch = line.match(emailInTextPattern);
    const hasComma = line.includes(",");
    const [commaNamePart = "", commaEmailPart = ""] = line.split(",").map((part) => part.trim());
    const namePart = hasComma ? commaNamePart : line.replace(emailMatch?.[0] ?? "", "").trim();
    const emailPart = hasComma ? commaEmailPart : emailMatch?.[0] ?? "";
    const email = emailPart.toLowerCase();

    if (!namePart || !emailPattern.test(email)) {
      errors.push(`Line ${index + 1} must include "Full Name, email@example.com" or "Full Name email@example.com"`);
      continue;
    }

    const [firstName = "", ...lastNameParts] = namePart.split(/\s+/);
    participants.push({
      firstName,
      lastName: lastNameParts.join(" ") || "-",
      email
    });
  }

  return { participants, errors };
}

function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "Participant", lastName: "-" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "-" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

function primaryContactAsParticipant(input: {
  participantCount: number;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string;
  primaryContactTitle?: string;
}): ParsedParticipant | null {
  if (input.participantCount > 1 || !emailPattern.test(input.primaryContactEmail)) {
    return null;
  }

  const name = splitFullName(input.primaryContactName);

  return {
    ...name,
    email: input.primaryContactEmail.toLowerCase(),
    title: input.primaryContactTitle,
    phone: input.primaryContactPhone
  };
}

export async function parseJotformWebhookRequest(request: Request): Promise<UnknownRecord> {
  const contentType = request.headers.get("content-type") ?? "";
  const url = new URL(request.url);
  const queryPayload = Object.fromEntries(url.searchParams.entries());
  delete queryPayload.secret;

  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    return { ...(json && typeof json === "object" ? json : {}), ...queryPayload } as UnknownRecord;
  }

  if (contentType.includes("form") || contentType.includes("multipart")) {
    const formData = await request.formData();
    const formPayload: UnknownRecord = {};

    for (const [key, value] of formData.entries()) {
      formPayload[key] = typeof value === "string" ? value : value.name;
    }

    return { ...formPayload, ...queryPayload };
  }

  const text = await request.text();
  return { ...parseJsonObject(text), ...queryPayload };
}

export function resolveJotformCohort(
  payload: {
    routing: { cohortId?: string; cohortSlug?: string; formId?: string; landingPageUrl?: string };
  },
  mappings: JotformFormMapping[]
): { cohortId: string; cohortSlug: string; mapping?: JotformFormMapping } {
  const mapping = mappings.find((item) => item.active && item.formId === payload.routing.formId);

  if (payload.routing.cohortId) {
    return { cohortId: payload.routing.cohortId, cohortSlug: "", mapping };
  }

  if (payload.routing.cohortSlug) {
    return { cohortId: "", cohortSlug: payload.routing.cohortSlug, mapping };
  }

  const landingPageRoute = resolveLandingPageRoute(mapping, payload.routing.landingPageUrl ?? "");

  if (landingPageRoute) {
    return { cohortId: landingPageRoute.cohortId, cohortSlug: "", mapping };
  }

  if (mapping?.requireCohortSlug) {
    throw Object.assign(new Error(`Jotform form ${mapping.formId} requires a valid cohortSlug`), {
      code: "BAD_REQUEST",
      status: 400
    });
  }

  if (mapping?.defaultCohortId) {
    return { cohortId: mapping.defaultCohortId, cohortSlug: "", mapping };
  }

  return { cohortId: "", cohortSlug: "", mapping };
}

export function normalizeJotformRegistrationPayload(payload: UnknownRecord, mappings: JotformFormMapping[] = []) {
  const flat = normalizeFlatPayload(payload);
  const organization = (flat.organization && typeof flat.organization === "object" ? flat.organization : flat) as UnknownRecord;
  const registration = (flat.registration && typeof flat.registration === "object" ? flat.registration : flat) as UnknownRecord;
  const payment = (flat.payment && typeof flat.payment === "object" ? flat.payment : registration) as UnknownRecord;
  const supportingDocuments = (flat.supportingDocuments && typeof flat.supportingDocuments === "object" ? flat.supportingDocuments : registration) as UnknownRecord;
  const initialFormId = readString(firstValue(flat, ["formID", "formId", "form_id"]));
  const existingMapping = mappings.find((item) => item.active && item.formId === initialFormId);
  const fieldMap = readFieldMap(existingMapping);
  const rawParticipants = flat.participants ?? flat.Participants ?? flat.participantList;
  const participantText = mappedFirstValue(flat, flat, fieldMap, "participantText", [
    "participantCsv",
    "participantsCsv",
    "participantText",
    "participantNamesEmails",
    "participantNamesAndEmails",
    "teamParticipants",
    "TeamParticipants",
    "namesAndEmails",
    "NamesEmails",
    "Please enter the names and email addresses of all participants, one per line, in the following format: Full Name, Email"
  ]) ?? Object.values(flat).find((value) => readString(value).includes(",") && emailInTextPattern.test(readString(value)));
  const parsedParticipantText = parseParticipantCsvText(participantText);
  const participants = [
    ...normalizeParticipants(rawParticipants),
    ...parsedParticipantText.participants
  ];
  const formId = readString(mappedFirstValue(flat, flat, fieldMap, "formId", ["formID", "formId", "form_id"]));
  const landingPageCandidate = mappedFirstValue(flat, registration, fieldMap, "landingPageUrl", ["landingPageUrl", "landing_page_url", "Get Page URL", "lead_source", "q25_leadSource", "q59_typeA59"]);
  const referrerCandidate = mappedFirstValue(flat, registration, fieldMap, "referrerUrl", ["referrerUrl", "referrer", "Referrer"]);
  const landingPageUrl = firstUrlFromText(landingPageCandidate);
  const referrerUrl = firstUrlFromText(referrerCandidate);
  const sourceUrls = [landingPageUrl, referrerUrl, landingPageCandidate, referrerCandidate, firstValue(flat, ["pretty", "rawRequest"])];
  const routing = resolveJotformCohort(
    {
      routing: {
        cohortId: readString(firstValue(registration, ["cohortId", "cohort_id", "CohortId"])),
        cohortSlug: readString(mappedFirstValue(flat, registration, fieldMap, "cohortSlug", ["cohortSlug", "cohort_slug", "CohortSlug"])),
        landingPageUrl,
        formId
      }
    },
    mappings
  );
  const primaryContactFirstName = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactFirstName", ["primaryContactFirstName", "contactFirstName", "registrantFirstName", "firstName", "First Name", "first"]));
  const primaryContactLastName = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactLastName", ["primaryContactLastName", "contactLastName", "registrantLastName", "lastName", "Last Name", "last"]));
  const primaryContactFullName = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactName", ["primaryContactName", "contactName", "registrantName", "fullName", "q7_name", "Name", "name"]));
  const primaryContactName = primaryContactFullName || [primaryContactFirstName, primaryContactLastName].filter(Boolean).join(" ");
  const primaryContactEmail = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactEmail", ["primaryContactEmail", "contactEmail", "registrantEmail", "q12_email", "Email", "email"]));
  const primaryContactPhone = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactPhone", ["primaryContactPhone", "contactPhone", "registrantPhone", "q13_billTo13", "Phone Number", "phone"]));
  const primaryContactTitle = readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactTitle", ["primaryContactTitle", "contactTitle", "q63_title", "Title", "title"]));
  const declaredParticipantCount = readParticipantCount(mappedFirstValue(flat, registration, fieldMap, "participantCount", [
    "participantCount",
    "q20_howMany",
    "numberOfParticipants",
    "participantsCount",
    "How many participants will be joining?",
    "Please select how many participants will be joining?"
  ]));
  const fallbackParticipant = participants.length === 0
    ? primaryContactAsParticipant({
        participantCount: declaredParticipantCount,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone,
        primaryContactTitle
      })
    : null;
  const normalizedParticipants = fallbackParticipant ? [fallbackParticipant] : participants;
  const participantCount = declaredParticipantCount || normalizedParticipants.length;

  return {
    source: "jotform",
    externalSubmissionId: readString(mappedFirstValue(flat, flat, fieldMap, "submissionId", ["submissionID", "submissionId", "submission_id", "id"])),
    participantParseErrors: parsedParticipantText.errors,
    routing: {
      formId,
      cohortId: routing.cohortId,
      cohortSlug: routing.cohortSlug,
      mappingId: routing.mapping?.id ?? ""
    },
    organization: {
      id: readString(firstValue(organization, ["organizationId", "orgId"])),
      name: readString(mappedFirstValue(flat, organization, fieldMap, "organizationName", ["Name of Organization", "q15_nameOf", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName"])),
      type: readEnumValue(OrganizationType, firstValue(organization, ["organizationType", "type"]), OrganizationType.DISTRICT),
      city: readString(mappedFirstValue(flat, organization, fieldMap, "organizationCity", ["organizationCity", "districtCity", "schoolCity", "city", "City"])),
      state: readString(mappedFirstValue(flat, organization, fieldMap, "organizationState", ["organizationState", "districtState", "schoolState", "state", "State"])),
      phone: readString(mappedFirstValue(flat, organization, fieldMap, "organizationPhone", ["phone", "Phone", "Phone Number"])),
      notes: readString(firstValue(organization, ["organizationNotes", "notes"]))
    },
    registration: {
      cohortId: routing.cohortId,
      cohortSlug: routing.cohortSlug,
      formId: readString(firstValue(registration, ["formId", "form_id"])),
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      primaryContactTitle,
      billingContactName: readString(firstValue(registration, ["billingContactName", "billingName"])),
      billingContactEmail: readString(firstValue(registration, ["billingContactEmail", "billingEmail"])),
      billingAddress: readString(mappedFirstValue(flat, registration, fieldMap, "organizationAddress", ["billingAddress", "address"])),
      paymentMethod: readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "q46_preferredMethod", "method", "Preferred method of payment?"])),
      paymentStatus: readPaymentStatus(
        mappedFirstValue(flat, payment, fieldMap, "paymentStatus", ["paymentStatus", "status"]),
        readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "q46_preferredMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(mappedFirstValue(flat, payment, fieldMap, "invoiceNumber", ["invoiceNumber", "invoice"])),
      purchaseOrderNumber: readString(mappedFirstValue(flat, payment, fieldMap, "purchaseOrderNumber", ["purchaseOrderNumber", "poNumber", "purchaseOrder"])),
      quickBooksCustomerRef: readString(firstValue(payment, ["quickBooksCustomerRef", "quickbooksCustomerId"])),
      quickBooksInvoiceRef: readString(firstValue(payment, ["quickBooksInvoiceRef", "quickbooksInvoiceId"])),
      totalAmount: readNumber(mappedFirstValue(flat, payment, fieldMap, "totalAmount", ["totalAmount", "q56_totalCost56", "amount", "total", "CC - Total", "Total Cost"])),
      participantCount,
      status: readEnumValue(RegistrationStatus, firstValue(registration, ["registrationStatus"]), RegistrationStatus.NEW),
      notes: readString(mappedFirstValue(flat, registration, fieldMap, "notes", ["notes", "additionalNotes", "How did you hear about us?"])),
      utmSource: readUtmValue(flat, fieldMap, "utmSource", ["utm_source", "utmSource", "UTM Source"], sourceUrls),
      utmMedium: readUtmValue(flat, fieldMap, "utmMedium", ["utm_medium", "utmMedium", "UTM Medium"], sourceUrls),
      utmCampaign: readUtmValue(flat, fieldMap, "utmCampaign", ["utm_campaign", "utmCampaign", "UTM Campaign"], sourceUrls),
      utmContent: readUtmValue(flat, fieldMap, "utmContent", ["utm_content", "utmContent", "UTM Content"], sourceUrls),
      utmTerm: readUtmValue(flat, fieldMap, "utmTerm", ["utm_term", "utmTerm", "UTM Term"], sourceUrls),
      landingPageUrl,
      referrerUrl,
      w9Url: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "w9Url", ["w9Url", "w9", "w9Link"])),
      invoiceUrl: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "invoiceUrl", ["invoiceUrl", "invoiceLink"])),
      confirmationDocsSentAt: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "confirmationDocsSentAt", ["confirmationDocsSentAt"]))
    },
    participants: normalizedParticipants,
    payment: {
      amount: readNumber(mappedFirstValue(flat, payment, fieldMap, "totalAmount", ["paymentAmount", "q56_totalCost56", "amount", "totalAmount", "total", "CC - Total", "Total Cost"])),
      method: readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "q46_preferredMethod", "method", "Preferred method of payment?"])),
      status: readPaymentStatus(
        mappedFirstValue(flat, payment, fieldMap, "paymentStatus", ["paymentStatus", "status"]),
        readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "q46_preferredMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(mappedFirstValue(flat, payment, fieldMap, "invoiceNumber", ["invoiceNumber", "invoice"])),
      quickBooksPaymentRef: readString(firstValue(payment, ["quickBooksPaymentRef", "quickbooksPaymentId"])),
      notes: readString(firstValue(payment, ["paymentNotes"]))
    }
  };
}

function buildFieldOptions(flat: UnknownRecord) {
  const deduped = new Map<string, { key: string; label: string; rawLabel: string; sampleValue: string }>();

  Object.entries(flat)
    .filter(([key, value]) => readString(value) && !isNoisyJotformField(key, value))
    .forEach(([key, value]) => {
      const option = {
        key,
        label: friendlyJotformFieldLabel(key, value),
        rawLabel: humanizeFieldKey(key),
        sampleValue: readString(value).slice(0, 180)
      };
      const dedupeKey = `${normalizeKey(option.label)}:${normalizeKey(option.sampleValue)}`;
      const existing = deduped.get(dedupeKey);

      if (!existing || optionRank(option.key) < optionRank(existing.key)) {
        deduped.set(dedupeKey, option);
      }
    });

  return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildSuggestedFieldMap(flat: UnknownRecord): FieldMap {
  return jotformTargetFields.reduce<FieldMap>((acc, target) => {
    const key = findSuggestedFieldKey(flat, target);

    if (key) {
      acc[target.target] = key;
    }

    return acc;
  }, {});
}

export function previewJotformRegistrationPayload(payload: UnknownRecord, mappings: JotformFormMapping[] = []) {
  const flat = normalizeFlatPayload(payload);
  const fieldPreview = Object.entries(flat)
    .filter(([, value]) => readString(value))
    .slice(0, 30)
    .map(([key, value]) => ({
      key,
      value: readString(value).slice(0, 240)
    }));

  try {
    const normalized = normalizeJotformRegistrationPayload(payload, mappings);

    return {
      formId: normalized.routing.formId,
      submissionId: normalized.externalSubmissionId,
      cohortSlug: normalized.routing.cohortSlug,
      mappingId: normalized.routing.mappingId,
      hasMapping: Boolean(normalized.routing.mappingId),
      primaryContactName: normalized.registration.primaryContactName,
      primaryContactEmail: normalized.registration.primaryContactEmail,
      organizationName: normalized.organization.name,
      landingPageUrl: normalized.registration.landingPageUrl,
      participantCount: normalized.registration.participantCount,
      parsedParticipantCount: normalized.participants.length,
      participantParseErrors: normalized.participantParseErrors,
      normalized,
      fieldPreview,
      fieldOptions: buildFieldOptions(flat),
      targetFields: jotformTargetFields.map(({ target, label, category }) => ({ target, label, category })),
      suggestedFieldMap: {
        ...buildSuggestedFieldMap(flat),
        ...readFieldMap(mappings.find((mapping) => mapping.id === normalized.routing.mappingId))
      }
    };
  } catch (error) {
    return {
      formId: readString(firstValue(flat, ["formID", "formId", "form_id"])),
      submissionId: readString(firstValue(flat, ["submissionID", "submissionId", "submission_id", "id"])),
      cohortSlug: readString(firstValue(flat, ["cohortSlug", "cohort_slug", "CohortSlug"])),
      mappingId: "",
      hasMapping: false,
      primaryContactName: readString(firstValue(flat, ["primaryContactName", "contactName", "registrantName", "q7_name", "Name", "name"])),
      primaryContactEmail: readString(firstValue(flat, ["primaryContactEmail", "contactEmail", "registrantEmail", "q12_email", "Email", "email"])),
      organizationName: readString(firstValue(flat, ["Name of Organization", "q15_nameOf", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName"])),
      landingPageUrl: firstUrlFromText(firstValue(flat, ["landingPageUrl", "landing_page_url", "Get Page URL", "lead_source", "q25_leadSource", "q59_typeA59"])),
      participantCount: readParticipantCount(firstValue(flat, ["participantCount", "q20_howMany", "numberOfParticipants", "participantsCount"])),
      parsedParticipantCount: 0,
      participantParseErrors: [error instanceof Error ? error.message : "Unable to normalize Jotform payload"],
      normalized: null,
      fieldPreview,
      fieldOptions: buildFieldOptions(flat),
      targetFields: jotformTargetFields.map(({ target, label, category }) => ({ target, label, category })),
      suggestedFieldMap: buildSuggestedFieldMap(flat)
    };
  }
}
