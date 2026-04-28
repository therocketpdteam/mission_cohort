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
  "cohort.startDate",
  "cohort.presenterName",
  "session.title",
  "session.startTime",
  "participant.firstName",
  "participant.lastName",
  "participant.email",
  "organization.name",
  "registration.primaryContactName",
  "registration.invoiceNumber",
  "registration.paymentStatus"
]);

export const mergeFields = Array.from(allowedFields);

export const sampleMergeContext: MergeFieldContext = {
  cohort: {
    title: "Instructional Leadership Spring Cohort",
    startDate: "May 12, 2026",
    presenterName: "Maya Rivera"
  },
  session: {
    title: "Leadership Foundations",
    startTime: "May 12, 2026 at 10:00 AM"
  },
  participant: {
    firstName: "Jordan",
    lastName: "Kim",
    email: "jordan.kim@example.com"
  },
  organization: {
    name: "Northview School District"
  },
  registration: {
    primaryContactName: "Avery Brooks",
    invoiceNumber: "INV-1001",
    paymentStatus: "INVOICED"
  }
};

function getPathValue(context: MergeFieldContext, path: string) {
  const [namespace, key] = path.split(".");
  const scope = context[namespace as keyof MergeFieldContext];
  const value = scope?.[key];

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
