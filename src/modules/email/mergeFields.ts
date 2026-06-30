export type MergeFieldContext = {
  cohort?: Record<string, unknown>;
  session?: Record<string, unknown>;
  participant?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  registration?: Record<string, unknown>;
  support?: Record<string, unknown>;
};

export type RenderMergeResult = {
  output: string;
  warnings: string[];
};

const allowedFields = new Set([
  "cohort.title",
  "cohort.shortName",
  "cohort.description",
  "cohort.startDate",
  "cohort.endDate",
  "cohort.defaultTimezone",
  "cohort.pricePerParticipant",
  "cohort.presenterName",
  "cohort.presenterFirstName",
  "cohort.presenterLastName",
  "cohort.presenterEmail",
  "session.sessionNumber",
  "session.title",
  "session.description",
  "session.startTime",
  "session.endTime",
  "session.meetingUrl",
  "session.location",
  "session.recordingUrl",
  "session.slidesUrl",
  "session.resourcesUrl",
  "participant.fullName",
  "participant.firstName",
  "participant.lastName",
  "participant.email",
  "organization.name",
  "organization.addressLine1",
  "organization.addressLine2",
  "organization.city",
  "organization.state",
  "organization.zip",
  "organization.phone",
  "registration.primaryContactName",
  "registration.primaryContactEmail",
  "registration.primaryContactPhone",
  "registration.billingContactName",
  "registration.billingContactEmail",
  "registration.invoiceNumber",
  "registration.purchaseOrderNumber",
  "registration.paymentMethod",
  "registration.paymentStatus",
  "registration.participantCount",
  "registration.totalAmount",
  "registration.w9Url",
  "registration.invoiceUrl",
  "support.email",
  "support.phone",
  "support.teamName"
]);

export const mergeFields = Array.from(allowedFields);

export const sampleMergeContext: MergeFieldContext = {
  cohort: {
    title: "Instructional Leadership Spring Cohort",
    shortName: "ILS Spring",
    description: "A live-virtual professional learning cohort for instructional leaders.",
    startDate: "May 12, 2026",
    endDate: "June 9, 2026",
    defaultTimezone: "America/New_York",
    pricePerParticipant: "$795",
    presenterName: "Maya Rivera",
    presenterFirstName: "Maya",
    presenterLastName: "Rivera",
    presenterEmail: "maya@example.com"
  },
  session: {
    sessionNumber: "1",
    title: "Leadership Foundations",
    description: "A practical session on leadership routines.",
    startTime: "May 12, 2026 at 10:00 AM",
    endTime: "May 12, 2026 at 11:30 AM",
    meetingUrl: "https://zoom.us/j/123456789",
    location: "Zoom",
    recordingUrl: "https://learn.rocketpd.com/recordings",
    slidesUrl: "https://learn.rocketpd.com/slides",
    resourcesUrl: "https://learn.rocketpd.com/resources"
  },
  participant: {
    fullName: "Jordan Kim",
    firstName: "Jordan",
    lastName: "Kim",
    email: "jordan.kim@example.com"
  },
  organization: {
    name: "Northview School District",
    addressLine1: "100 Main Street",
    addressLine2: "Suite 200",
    city: "Atlanta",
    state: "GA",
    zip: "30318",
    phone: "(404) 555-0199"
  },
  registration: {
    primaryContactName: "Avery Brooks",
    primaryContactEmail: "avery@example.com",
    primaryContactPhone: "(404) 555-0144",
    billingContactName: "Avery Brooks",
    billingContactEmail: "billing@example.com",
    invoiceNumber: "INV-1001",
    purchaseOrderNumber: "PO-2026-1001",
    paymentMethod: "Purchase Order",
    paymentStatus: "INVOICED",
    participantCount: "4",
    totalAmount: "$3,180",
    w9Url: "https://rocketpd.com/w9.pdf",
    invoiceUrl: "https://rocketpd.com/invoices/INV-1001.pdf"
  },
  support: {
    email: "info@rocketpd.com",
    phone: "(855) 757-6253",
    teamName: "The RocketPD Team"
  }
};

function getPathValue(context: MergeFieldContext, path: string) {
  const [namespace, key] = path.split(".");
  const scope = context[namespace as keyof MergeFieldContext] ?? (
    namespace === "support" ? sampleMergeContext.support : undefined
  );
  let value = scope?.[key];

  if (namespace === "participant" && key === "fullName" && !value) {
    value = [scope?.firstName, scope?.lastName].filter(Boolean).join(" ");
  }

  if (namespace === "registration" && key === "invoiceUrl" && !value && Array.isArray(scope?.invoiceDrafts)) {
    value = (scope.invoiceDrafts as Array<Record<string, unknown>>).find((invoice) => invoice.pdfUrl)?.pdfUrl;
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  return value == null ? "" : String(value);
}

export function renderMergeFields(template: string, context: MergeFieldContext, previewMode = false): RenderMergeResult {
  const warnings: string[] = [];
  const output = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, field: string) => {
    if (!allowedFields.has(field)) {
      warnings.push(`Unknown merge field: ${field}`);
      return previewMode ? `[unknown:${field}]` : "";
    }

    const value = getPathValue(context, field);
    if (!value) {
      warnings.push(`Missing value for merge field: ${field}`);
      return previewMode ? `[missing:${field}]` : "";
    }

    return value;
  });

  return { output, warnings };
}

export function validateMergeFields(template: string) {
  return renderMergeFields(template, sampleMergeContext, true).warnings;
}
