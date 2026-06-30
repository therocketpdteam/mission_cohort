export type MergeFieldContext = {
  cohort?: Record<string, unknown>;
  session?: Record<string, unknown>;
  participant?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  registration?: Record<string, unknown>;
};

export type RenderMergeResult = {
  output: string;
  warnings: string[];
};

const allowedFields = new Set([
  "cohort.title",
  "cohort.description",
  "cohort.startDate",
  "cohort.presenterName",
  "session.title",
  "session.startTime",
  "session.endTime",
  "session.meetingUrl",
  "session.location",
  "session.recordingUrl",
  "session.resourcesUrl",
  "participant.firstName",
  "participant.lastName",
  "participant.email",
  "organization.name",
  "organization.city",
  "organization.state",
  "registration.primaryContactName",
  "registration.invoiceNumber",
  "registration.paymentStatus",
  "registration.participantCount",
  "registration.totalAmount",
  "registration.w9Url",
  "registration.invoiceUrl"
]);

export const mergeFields = Array.from(allowedFields);

export const sampleMergeContext: MergeFieldContext = {
  cohort: {
    title: "Instructional Leadership Spring Cohort",
    description: "A live-virtual professional learning cohort for instructional leaders.",
    startDate: "May 12, 2026",
    presenterName: "Maya Rivera"
  },
  session: {
    title: "Leadership Foundations",
    startTime: "May 12, 2026 at 10:00 AM",
    endTime: "May 12, 2026 at 11:30 AM",
    meetingUrl: "https://zoom.us/j/123456789",
    location: "Zoom",
    recordingUrl: "https://learn.rocketpd.com/recordings",
    resourcesUrl: "https://learn.rocketpd.com/resources"
  },
  participant: {
    firstName: "Jordan",
    lastName: "Kim",
    email: "jordan.kim@example.com"
  },
  organization: {
    name: "Northview School District",
    city: "Atlanta",
    state: "GA"
  },
  registration: {
    primaryContactName: "Avery Brooks",
    invoiceNumber: "INV-1001",
    paymentStatus: "INVOICED",
    participantCount: "4",
    totalAmount: "$3,180",
    w9Url: "https://rocketpd.com/w9.pdf",
    invoiceUrl: "https://rocketpd.com/invoices/INV-1001.pdf"
  }
};

function getPathValue(context: MergeFieldContext, path: string) {
  const [namespace, key] = path.split(".");
  const scope = context[namespace as keyof MergeFieldContext];
  let value = scope?.[key];

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
