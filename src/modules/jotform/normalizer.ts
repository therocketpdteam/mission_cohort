import { OrganizationType, PaymentMethod, PaymentStatus, RegistrationStatus } from "@prisma/client";

type UnknownRecord = Record<string, unknown>;

function readString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstValue(payload: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];

    if (value != null && readString(value)) {
      return value;
    }
  }

  return undefined;
}

function normalizeAnswers(payload: UnknownRecord) {
  const answers = payload.answers;

  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return {};
  }

  return Object.values(answers as Record<string, UnknownRecord>).reduce<UnknownRecord>((acc, answer) => {
    const name = readString(answer.name ?? answer.text).replace(/\s+/g, "");
    const value = answer.answer ?? answer.prettyFormat ?? answer.text;

    if (name) {
      acc[name] = value;
    }

    return acc;
  }, {});
}

function normalizeParticipants(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((participant) => {
    const row = participant && typeof participant === "object" ? (participant as UnknownRecord) : {};

    return {
      firstName: readString(firstValue(row, ["firstName", "first_name", "FirstName"])),
      lastName: readString(firstValue(row, ["lastName", "last_name", "LastName"])),
      email: readString(firstValue(row, ["email", "Email"])),
      title: readString(firstValue(row, ["title", "Title"])),
      phone: readString(firstValue(row, ["phone", "Phone"]))
    };
  });
}

export function normalizeJotformRegistrationPayload(payload: UnknownRecord) {
  const flat = { ...normalizeAnswers(payload), ...payload };
  const organization = (flat.organization && typeof flat.organization === "object" ? flat.organization : flat) as UnknownRecord;
  const registration = (flat.registration && typeof flat.registration === "object" ? flat.registration : flat) as UnknownRecord;
  const payment = (flat.payment && typeof flat.payment === "object" ? flat.payment : registration) as UnknownRecord;
  const supportingDocuments = (flat.supportingDocuments && typeof flat.supportingDocuments === "object" ? flat.supportingDocuments : registration) as UnknownRecord;
  const rawParticipants = flat.participants ?? flat.Participants ?? flat.participantList;

  return {
    source: "jotform",
    externalSubmissionId: readString(firstValue(flat, ["submissionID", "submissionId", "id"])),
    organization: {
      id: readString(firstValue(organization, ["organizationId", "orgId"])),
      name: readString(firstValue(organization, ["organizationName", "organization", "districtName", "DistrictName", "name"])),
      type: (readString(firstValue(organization, ["organizationType", "type"])) || OrganizationType.DISTRICT) as OrganizationType,
      city: readString(firstValue(organization, ["city", "City"])),
      state: readString(firstValue(organization, ["state", "State"])),
      phone: readString(firstValue(organization, ["phone", "Phone"])),
      notes: readString(firstValue(organization, ["organizationNotes", "notes"]))
    },
    registration: {
      cohortId: readString(firstValue(registration, ["cohortId", "cohort_id", "CohortId"])),
      formId: readString(firstValue(registration, ["formId", "form_id"])),
      primaryContactName: readString(firstValue(registration, ["primaryContactName", "contactName", "name"])),
      primaryContactEmail: readString(firstValue(registration, ["primaryContactEmail", "contactEmail", "email"])),
      primaryContactPhone: readString(firstValue(registration, ["primaryContactPhone", "contactPhone", "phone"])),
      primaryContactTitle: readString(firstValue(registration, ["primaryContactTitle", "contactTitle", "title"])),
      billingContactName: readString(firstValue(registration, ["billingContactName", "billingName"])),
      billingContactEmail: readString(firstValue(registration, ["billingContactEmail", "billingEmail"])),
      billingAddress: readString(firstValue(registration, ["billingAddress", "address"])),
      paymentMethod: (readString(firstValue(payment, ["paymentMethod", "method"])) || PaymentMethod.UNKNOWN) as PaymentMethod,
      paymentStatus: (readString(firstValue(payment, ["paymentStatus", "status"])) || PaymentStatus.PENDING) as PaymentStatus,
      invoiceNumber: readString(firstValue(payment, ["invoiceNumber", "invoice"])),
      purchaseOrderNumber: readString(firstValue(payment, ["purchaseOrderNumber", "poNumber", "purchaseOrder"])),
      quickBooksCustomerRef: readString(firstValue(payment, ["quickBooksCustomerRef", "quickbooksCustomerId"])),
      quickBooksInvoiceRef: readString(firstValue(payment, ["quickBooksInvoiceRef", "quickbooksInvoiceId"])),
      totalAmount: readNumber(firstValue(payment, ["totalAmount", "amount", "total"])),
      participantCount: readNumber(firstValue(registration, ["participantCount", "numberOfParticipants", "participantsCount"])),
      status: (readString(firstValue(registration, ["registrationStatus"])) || RegistrationStatus.NEW) as RegistrationStatus,
      notes: readString(firstValue(registration, ["notes", "additionalNotes"])),
      w9Url: readString(firstValue(supportingDocuments, ["w9Url", "w9", "w9Link"])),
      invoiceUrl: readString(firstValue(supportingDocuments, ["invoiceUrl", "invoiceLink"])),
      confirmationDocsSentAt: readString(firstValue(supportingDocuments, ["confirmationDocsSentAt"]))
    },
    participants: normalizeParticipants(rawParticipants),
    payment: {
      amount: readNumber(firstValue(payment, ["paymentAmount", "amount", "totalAmount", "total"])),
      method: (readString(firstValue(payment, ["paymentMethod", "method"])) || PaymentMethod.UNKNOWN) as PaymentMethod,
      status: (readString(firstValue(payment, ["paymentStatus", "status"])) || PaymentStatus.PENDING) as PaymentStatus,
      invoiceNumber: readString(firstValue(payment, ["invoiceNumber", "invoice"])),
      quickBooksPaymentRef: readString(firstValue(payment, ["quickBooksPaymentRef", "quickbooksPaymentId"])),
      notes: readString(firstValue(payment, ["paymentNotes"]))
    }
  };
}
