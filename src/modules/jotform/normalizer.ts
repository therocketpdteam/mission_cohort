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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const rawParticipants = flat.participants ?? flat.Participants ?? flat.participantList;
  const participantText = firstValue(flat, [
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
  const formId = readString(firstValue(flat, ["formID", "formId", "form_id"]));
  const routing = resolveJotformCohort(
    {
      routing: {
        cohortId: readString(firstValue(registration, ["cohortId", "cohort_id", "CohortId"])),
        cohortSlug: readString(firstValue(registration, ["cohortSlug", "cohort_slug", "CohortSlug"])),
        formId
      }
    },
    mappings
  );

  return {
    source: "jotform",
    externalSubmissionId: readString(firstValue(flat, ["submissionID", "submissionId", "submission_id", "id"])),
    participantParseErrors: parsedParticipantText.errors,
    routing: {
      formId,
      cohortId: routing.cohortId,
      cohortSlug: routing.cohortSlug,
      mappingId: routing.mapping?.id ?? ""
    },
    organization: {
      id: readString(firstValue(organization, ["organizationId", "orgId"])),
      name: readString(firstValue(organization, ["Name of Organization", "organizationName", "districtOrganizationName", "districtOrOrganizationName", "organization", "districtName", "DistrictName", "name"])),
      type: readEnumValue(OrganizationType, firstValue(organization, ["organizationType", "type"]), OrganizationType.DISTRICT),
      city: readString(firstValue(organization, ["city", "City"])),
      state: readString(firstValue(organization, ["state", "State"])),
      phone: readString(firstValue(organization, ["phone", "Phone", "Phone Number"])),
      notes: readString(firstValue(organization, ["organizationNotes", "notes"]))
    },
    registration: {
      cohortId: routing.cohortId,
      cohortSlug: routing.cohortSlug,
      formId: readString(firstValue(registration, ["formId", "form_id"])),
      primaryContactName: readString(firstValue(registration, ["primaryContactName", "contactName", "registrantName", "name"])),
      primaryContactEmail: readString(firstValue(registration, ["primaryContactEmail", "contactEmail", "registrantEmail", "email"])),
      primaryContactPhone: readString(firstValue(registration, ["primaryContactPhone", "contactPhone", "registrantPhone", "phone", "Phone Number"])),
      primaryContactTitle: readString(firstValue(registration, ["primaryContactTitle", "contactTitle", "title"])),
      billingContactName: readString(firstValue(registration, ["billingContactName", "billingName"])),
      billingContactEmail: readString(firstValue(registration, ["billingContactEmail", "billingEmail"])),
      billingAddress: readString(firstValue(registration, ["billingAddress", "address"])),
      paymentMethod: readPaymentMethod(firstValue(payment, ["paymentMethod", "method", "Preferred method of payment?"])),
      paymentStatus: readEnumValue(
        PaymentStatus,
        firstValue(payment, ["paymentStatus", "status"]),
        readPaymentMethod(firstValue(payment, ["paymentMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(firstValue(payment, ["invoiceNumber", "invoice"])),
      purchaseOrderNumber: readString(firstValue(payment, ["purchaseOrderNumber", "poNumber", "purchaseOrder"])),
      quickBooksCustomerRef: readString(firstValue(payment, ["quickBooksCustomerRef", "quickbooksCustomerId"])),
      quickBooksInvoiceRef: readString(firstValue(payment, ["quickBooksInvoiceRef", "quickbooksInvoiceId"])),
      totalAmount: readNumber(firstValue(payment, ["totalAmount", "amount", "total", "CC - Total", "Total Cost"])),
      participantCount: readParticipantCount(firstValue(registration, [
        "participantCount",
        "numberOfParticipants",
        "participantsCount",
        "How many participants will be joining?",
        "Please select how many participants will be joining?"
      ])),
      status: readEnumValue(RegistrationStatus, firstValue(registration, ["registrationStatus"]), RegistrationStatus.NEW),
      notes: readString(firstValue(registration, ["notes", "additionalNotes", "How did you hear about us?"])),
      w9Url: readString(firstValue(supportingDocuments, ["w9Url", "w9", "w9Link"])),
      invoiceUrl: readString(firstValue(supportingDocuments, ["invoiceUrl", "invoiceLink"])),
      confirmationDocsSentAt: readString(firstValue(supportingDocuments, ["confirmationDocsSentAt"]))
    },
    participants,
    payment: {
      amount: readNumber(firstValue(payment, ["paymentAmount", "amount", "totalAmount", "total", "CC - Total", "Total Cost"])),
      method: readPaymentMethod(firstValue(payment, ["paymentMethod", "method", "Preferred method of payment?"])),
      status: readEnumValue(
        PaymentStatus,
        firstValue(payment, ["paymentStatus", "status"]),
        readPaymentMethod(firstValue(payment, ["paymentMethod", "method", "Preferred method of payment?"])) === PaymentMethod.CREDIT_CARD ? PaymentStatus.PAID : PaymentStatus.PENDING
      ),
      invoiceNumber: readString(firstValue(payment, ["invoiceNumber", "invoice"])),
      quickBooksPaymentRef: readString(firstValue(payment, ["quickBooksPaymentRef", "quickbooksPaymentId"])),
      notes: readString(firstValue(payment, ["paymentNotes"]))
    }
  };
}
