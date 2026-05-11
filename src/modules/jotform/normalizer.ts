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
type JotformTargetField = {
  target: string;
  label: string;
  category: string;
  aliases: string[];
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const jotformTargetFields: JotformTargetField[] = [
  { target: "formId", label: "Jotform form ID", category: "Form", aliases: ["formID", "formId", "form_id"] },
  { target: "submissionId", label: "Submission ID", category: "Form", aliases: ["submissionID", "submissionId", "submission_id", "id"] },
  { target: "cohortSlug", label: "Cohort slug", category: "Routing", aliases: ["cohortSlug", "cohort_slug", "CohortSlug"] },
  { target: "primaryContactName", label: "POC name", category: "Contact", aliases: ["primaryContactName", "contactName", "registrantName", "name", "Name"] },
  { target: "primaryContactEmail", label: "POC email", category: "Contact", aliases: ["primaryContactEmail", "contactEmail", "registrantEmail", "email", "Email"] },
  { target: "primaryContactPhone", label: "POC phone", category: "Contact", aliases: ["primaryContactPhone", "contactPhone", "registrantPhone", "phone", "Phone Number"] },
  { target: "primaryContactTitle", label: "POC title", category: "Contact", aliases: ["primaryContactTitle", "contactTitle", "title", "Title"] },
  { target: "organizationName", label: "Organization name", category: "Organization", aliases: ["Name of Organization", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName", "name"] },
  { target: "organizationAddress", label: "Organization address", category: "Organization", aliases: ["billingAddress", "address", "Address"] },
  { target: "organizationPhone", label: "Organization phone", category: "Organization", aliases: ["organizationPhone", "phone", "Phone", "Phone Number"] },
  { target: "participantCount", label: "Participant count", category: "Registration", aliases: ["participantCount", "numberOfParticipants", "participantsCount", "How many participants will be joining?", "Please select how many participants will be joining?"] },
  { target: "paymentMethod", label: "Payment method", category: "Payment", aliases: ["paymentMethod", "method", "Preferred method of payment?"] },
  { target: "paymentStatus", label: "Payment status", category: "Payment", aliases: ["paymentStatus", "status"] },
  { target: "totalAmount", label: "Total amount", category: "Payment", aliases: ["totalAmount", "amount", "total", "CC - Total", "Total Cost"] },
  { target: "purchaseOrderNumber", label: "PO number", category: "Payment", aliases: ["purchaseOrderNumber", "poNumber", "purchaseOrder"] },
  { target: "invoiceNumber", label: "Invoice number", category: "Payment", aliases: ["invoiceNumber", "invoice"] },
  { target: "notes", label: "Notes/source", category: "Registration", aliases: ["notes", "additionalNotes", "How did you hear about us?"] },
  { target: "participantText", label: "Participant names/emails text box", category: "Participants", aliases: ["participantCsv", "participantsCsv", "participantText", "participantNamesEmails", "participantNamesAndEmails", "teamParticipants", "TeamParticipants", "namesAndEmails", "NamesEmails", "Please enter the names and email addresses of all participants, one per line, in the following format: Full Name, Email"] },
  { target: "w9Url", label: "W-9 URL", category: "Documents", aliases: ["w9Url", "w9", "w9Link"] },
  { target: "invoiceUrl", label: "Invoice URL", category: "Documents", aliases: ["invoiceUrl", "invoiceLink"] },
  { target: "confirmationDocsSentAt", label: "Confirmation docs sent date", category: "Documents", aliases: ["confirmationDocsSentAt"] }
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

function mappedFirstValue(flat: UnknownRecord, source: UnknownRecord, fieldMap: FieldMap, target: string, fallbackKeys: string[]): unknown {
  const mappedKey = readString(fieldMap[target]);
  const mappedValue = mappedKey ? firstValue(flat, [mappedKey]) : undefined;

  if (mappedValue != null && readString(mappedValue)) {
    return mappedValue;
  }

  return firstValue(source, fallbackKeys);
}

function findSuggestedFieldKey(flat: UnknownRecord, target: JotformTargetField): string {
  const value = firstValue(flat, target.aliases);

  if (value == null || !readString(value)) {
    return "";
  }

  const aliasKeys = target.aliases.map(normalizeKey);
  return Object.keys(flat).find((key) => aliasKeys.includes(normalizeKey(key)) && readString(flat[key])) ?? "";
}

function humanizeFieldKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const lines = readString(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const participants: Array<{ firstName: string; lastName: string; email: string }> = [];
  const errors: string[] = [];

  for (const [index, line] of lines.entries()) {
    const emailMatch = line.match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/);
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
    routing: { cohortId?: string; cohortSlug?: string; formId?: string };
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
  ]) ?? Object.values(flat).find((value) => readString(value).includes(",") && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(readString(value)));
  const parsedParticipantText = parseParticipantCsvText(participantText);
  const participants = [
    ...normalizeParticipants(rawParticipants),
    ...parsedParticipantText.participants
  ];
  const formId = readString(mappedFirstValue(flat, flat, fieldMap, "formId", ["formID", "formId", "form_id"]));
  const routing = resolveJotformCohort(
    {
      routing: {
        cohortId: readString(firstValue(registration, ["cohortId", "cohort_id", "CohortId"])),
        cohortSlug: readString(mappedFirstValue(flat, registration, fieldMap, "cohortSlug", ["cohortSlug", "cohort_slug", "CohortSlug"])),
        formId
      }
    },
    mappings
  );

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
      name: readString(mappedFirstValue(flat, organization, fieldMap, "organizationName", ["Name of Organization", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName", "name"])),
      type: readEnumValue(OrganizationType, firstValue(organization, ["organizationType", "type"]), OrganizationType.DISTRICT),
      city: readString(firstValue(organization, ["city", "City"])),
      state: readString(firstValue(organization, ["state", "State"])),
      phone: readString(mappedFirstValue(flat, organization, fieldMap, "organizationPhone", ["phone", "Phone", "Phone Number"])),
      notes: readString(firstValue(organization, ["organizationNotes", "notes"]))
    },
    registration: {
      cohortId: routing.cohortId,
      cohortSlug: routing.cohortSlug,
      formId: readString(firstValue(registration, ["formId", "form_id"])),
      primaryContactName: readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactName", ["primaryContactName", "contactName", "registrantName", "name"])),
      primaryContactEmail: readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactEmail", ["primaryContactEmail", "contactEmail", "registrantEmail", "email"])),
      primaryContactPhone: readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactPhone", ["primaryContactPhone", "contactPhone", "registrantPhone", "phone", "Phone Number"])),
      primaryContactTitle: readString(mappedFirstValue(flat, registration, fieldMap, "primaryContactTitle", ["primaryContactTitle", "contactTitle", "title"])),
      billingContactName: readString(firstValue(registration, ["billingContactName", "billingName"])),
      billingContactEmail: readString(firstValue(registration, ["billingContactEmail", "billingEmail"])),
      billingAddress: readString(mappedFirstValue(flat, registration, fieldMap, "organizationAddress", ["billingAddress", "address"])),
      paymentMethod: readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "method", "Preferred method of payment?"])),
      paymentStatus: readEnumValue(
        PaymentStatus,
        mappedFirstValue(flat, payment, fieldMap, "paymentStatus", ["paymentStatus", "status"]),
        readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(mappedFirstValue(flat, payment, fieldMap, "invoiceNumber", ["invoiceNumber", "invoice"])),
      purchaseOrderNumber: readString(mappedFirstValue(flat, payment, fieldMap, "purchaseOrderNumber", ["purchaseOrderNumber", "poNumber", "purchaseOrder"])),
      quickBooksCustomerRef: readString(firstValue(payment, ["quickBooksCustomerRef", "quickbooksCustomerId"])),
      quickBooksInvoiceRef: readString(firstValue(payment, ["quickBooksInvoiceRef", "quickbooksInvoiceId"])),
      totalAmount: readNumber(mappedFirstValue(flat, payment, fieldMap, "totalAmount", ["totalAmount", "amount", "total", "CC - Total", "Total Cost"])),
      participantCount: readParticipantCount(mappedFirstValue(flat, registration, fieldMap, "participantCount", [
        "participantCount",
        "numberOfParticipants",
        "participantsCount",
        "How many participants will be joining?",
        "Please select how many participants will be joining?"
      ])),
      status: readEnumValue(RegistrationStatus, firstValue(registration, ["registrationStatus"]), RegistrationStatus.NEW),
      notes: readString(mappedFirstValue(flat, registration, fieldMap, "notes", ["notes", "additionalNotes", "How did you hear about us?"])),
      w9Url: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "w9Url", ["w9Url", "w9", "w9Link"])),
      invoiceUrl: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "invoiceUrl", ["invoiceUrl", "invoiceLink"])),
      confirmationDocsSentAt: readString(mappedFirstValue(flat, supportingDocuments, fieldMap, "confirmationDocsSentAt", ["confirmationDocsSentAt"]))
    },
    participants,
    payment: {
      amount: readNumber(mappedFirstValue(flat, payment, fieldMap, "totalAmount", ["paymentAmount", "amount", "totalAmount", "total", "CC - Total", "Total Cost"])),
      method: readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "method", "Preferred method of payment?"])),
      status: readEnumValue(
        PaymentStatus,
        mappedFirstValue(flat, payment, fieldMap, "paymentStatus", ["paymentStatus", "status"]),
        readPaymentMethod(mappedFirstValue(flat, payment, fieldMap, "paymentMethod", ["paymentMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(mappedFirstValue(flat, payment, fieldMap, "invoiceNumber", ["invoiceNumber", "invoice"])),
      quickBooksPaymentRef: readString(firstValue(payment, ["quickBooksPaymentRef", "quickbooksPaymentId"])),
      notes: readString(firstValue(payment, ["paymentNotes"]))
    }
  };
}

function buildFieldOptions(flat: UnknownRecord) {
  return Object.entries(flat)
    .filter(([, value]) => readString(value))
    .map(([key, value]) => ({
      key,
      label: humanizeFieldKey(key),
      sampleValue: readString(value).slice(0, 180)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
      primaryContactName: readString(firstValue(flat, ["primaryContactName", "contactName", "registrantName", "name"])),
      primaryContactEmail: readString(firstValue(flat, ["primaryContactEmail", "contactEmail", "registrantEmail", "email"])),
      organizationName: readString(firstValue(flat, ["Name of Organization", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName", "name"])),
      participantCount: readParticipantCount(firstValue(flat, ["participantCount", "numberOfParticipants", "participantsCount"])),
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
