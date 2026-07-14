import {
  CalendarInviteStatus,
  CohortStatus,
  CohortType,
  OrganizationType,
  ParticipantStatus,
  ParticipantListStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
  SyncStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseRosterText, type ParsedRosterParticipant } from "@/lib/rosterParser";
import { normalizeUsStateCode } from "@/modules/jotform";

export type HistoricalImportMapping = Record<string, string>;

export type HistoricalCohortImportDetails = {
  title?: string;
  shortName?: string;
  presenterId?: string;
  presenterName?: string;
  presenterEmail?: string;
  presenterShortName?: string;
  startDate?: string;
  endDate?: string;
  season?: string;
};

type CsvRow = {
  rowNumber: number;
  raw: Record<string, string>;
};

type NormalizedHistoricalRow = {
  cohortTitle: string;
  cohortShortName?: string;
  presenterId?: string;
  presenterName: string;
  presenterEmail?: string;
  presenterShortName?: string;
  startDate?: string;
  endDate?: string;
  season?: string;
  organizationName: string;
  organizationAddressLine1?: string;
  organizationAddressLine2?: string;
  organizationCity?: string;
  organizationState?: string;
  organizationZip?: string;
  organizationPhone?: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string;
  primaryContactTitle?: string;
  participantCount: number;
  participants: ParsedRosterParticipant[];
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  registrationDate?: string;
  invoiceNumber?: string;
  purchaseOrderNumber?: string;
  source?: string;
  utmSource?: string;
  utmCampaign?: string;
  notes?: string;
  sessionDates: string[];
};

const supportedFields = [
  "cohortTitle",
  "cohortShortName",
  "presenterName",
  "presenterEmail",
  "startDate",
  "endDate",
  "season",
  "organizationName",
  "organizationAddressLine1",
  "organizationAddressLine2",
  "organizationCity",
  "organizationState",
  "organizationZip",
  "organizationPhone",
  "primaryContactName",
  "primaryContactEmail",
  "primaryContactPhone",
  "primaryContactTitle",
  "participantCount",
  "participantText",
  "participantNames",
  "participantEmails",
  "participantTitles",
  "totalAmount",
  "paymentStatus",
  "paymentMethod",
  "registrationDate",
  "pocOnlyFlag",
  "invoiceNumber",
  "purchaseOrderNumber",
  "source",
  "utmSource",
  "utmCampaign",
  "notes",
  "sessionDates"
] as const;

const cohortDetailFields = new Set<string>(["cohortTitle", "cohortShortName", "presenterName", "presenterEmail", "startDate", "endDate", "season"]);

const fieldLabels: Record<string, string> = {
  cohortTitle: "Cohort title",
  cohortShortName: "Cohort short name",
  presenterName: "Presenter",
  presenterEmail: "Presenter email",
  startDate: "Start date",
  endDate: "End date",
  season: "Season",
  organizationName: "Organization",
  organizationAddressLine1: "Address line 1",
  organizationAddressLine2: "Address line 2",
  organizationCity: "City",
  organizationState: "State",
  organizationZip: "ZIP",
  organizationPhone: "Organization phone",
  primaryContactName: "POC name",
  primaryContactEmail: "POC email",
  primaryContactPhone: "POC phone",
  primaryContactTitle: "POC title",
  participantCount: "Participant count",
  participantText: "Participant roster text",
  participantNames: "Participant names",
  participantEmails: "Participant emails",
  participantTitles: "Participant titles",
  totalAmount: "Total amount",
  paymentStatus: "Payment status",
  paymentMethod: "Payment method",
  registrationDate: "Registration/payment date",
  pocOnlyFlag: "POC-only flag",
  invoiceNumber: "Invoice number",
  purchaseOrderNumber: "PO number",
  source: "Source",
  utmSource: "UTM source",
  utmCampaign: "UTM campaign",
  notes: "Notes",
  sessionDates: "Session dates"
};

const suggestions: Record<string, RegExp[]> = {
  cohortTitle: [/^cohort( title| name)?$/, /^program$/, /^course$/],
  cohortShortName: [/^short( name)?$/, /^cohort short/, /^code$/],
  presenterName: [/presenter/, /thought.*leader/, /^tl$/, /facilitator/],
  presenterEmail: [/presenter.*email/, /tl.*email/],
  startDate: [/start.*date/, /^start$/, /first.*session/],
  endDate: [/end.*date/, /^end$/, /last.*session/],
  season: [/season/, /term/],
  organizationName: [/organization/, /^org$/, /school/, /^district$/, /company/],
  organizationAddressLine1: [/address( line 1)?$/, /^address$/, /street/],
  organizationAddressLine2: [/address line 2/, /suite/, /unit/],
  organizationCity: [/^city$/, /town/],
  organizationState: [/^state$/, /province/],
  organizationZip: [/^zip$/, /postal/],
  organizationPhone: [/organization.*phone/, /school.*phone/],
  primaryContactName: [/poc.*name/, /contact.*name/, /registrant.*name/, /^name$/],
  primaryContactEmail: [/poc.*email/, /contact.*email/, /registrant.*email/, /^email$/],
  primaryContactPhone: [/poc.*phone/, /contact.*phone/, /^phone$/],
  primaryContactTitle: [/poc.*title/, /contact.*title/, /^title$/],
  participantCount: [/^participants$/, /^# participants$/, /participant.*count/, /roster.*count/, /seats?/, /qty|quantity/, /^#$/],
  participantText: [/participant.*list/, /roster/],
  participantNames: [/participant.*names?/],
  participantEmails: [/participant.*emails?/],
  participantTitles: [/participant.*titles?/],
  totalAmount: [/^total$/, /total.*amount/, /amount/, /revenue/, /sales/, /price/],
  paymentStatus: [/^status$/, /payment.*status/, /paid/],
  paymentMethod: [/payment.*method/, /method/],
  registrationDate: [/^date$/, /registration.*date/, /payment.*date/, /invoice.*date/],
  pocOnlyFlag: [/^poc$/, /poc.*only/, /admin.*contact/, /non.*participant/],
  invoiceNumber: [/invoice/, /^invoice #$/],
  purchaseOrderNumber: [/purchase.*order/, /^po($|\s|number|num)/],
  source: [/source/, /channel/, /origin/],
  utmSource: [/utm.*source/],
  utmCampaign: [/utm.*campaign/, /campaign/],
  notes: [/notes?/, /comments?/],
  sessionDates: [/session.*dates?/, /dates? of sessions?/]
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedHeader(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export function parseHistoricalCsv(csvText: string): { headers: string[]; rows: CsvRow[] } {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = splitCsvLine(lines[0] ?? "").map((header, index) => clean(header) || `Column ${index + 1}`);
  const rows = lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    return {
      rowNumber: index + 2,
      raw: headers.reduce<Record<string, string>>((acc, header, headerIndex) => {
        acc[header] = clean(cells[headerIndex]);
        return acc;
      }, {})
    };
  });

  return { headers, rows };
}

export function suggestHistoricalImportMapping(headers: string[]): HistoricalImportMapping {
  const normalized = headers.map((header) => ({ header, key: normalizedHeader(header) }));
  const mapping: HistoricalImportMapping = {};

  for (const field of supportedFields) {
    const match = suggestions[field]
      ?.map((pattern) => normalized.find((header) => pattern.test(header.key)))
      .find(Boolean);
    if (match) {
      mapping[field] = match.header;
    }
  }

  return mapping;
}

function value(row: CsvRow, mapping: HistoricalImportMapping, field: string) {
  const column = mapping[field];
  return column ? clean(row.raw[column]) : "";
}

function parseDateValue(input: string): Date | null {
  const raw = clean(input);
  if (!raw) return null;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const date = new Date(Date.UTC(year, Number(mdy[1]) - 1, Number(mdy[2]), 15, 0, 0));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseMoney(input: string) {
  const cleaned = clean(input).replace(/[$,]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function parseIntValue(input: string) {
  const value = Number(clean(input).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}

function parsePaymentStatus(input: string) {
  const raw = normalizedHeader(input);
  if (!raw) return PaymentStatus.PAID;
  if (/partial/.test(raw)) return PaymentStatus.PARTIALLY_PAID;
  if (/refund/.test(raw)) return PaymentStatus.REFUNDED;
  if (/cancel|withdraw|void/.test(raw)) return PaymentStatus.CANCELLED;
  if (/invoice/.test(raw)) return PaymentStatus.INVOICED;
  if (/pending|open|unpaid/.test(raw)) return PaymentStatus.PENDING;
  return PaymentStatus.PAID;
}

function parsePaymentMethod(input: string) {
  const raw = normalizedHeader(input);
  if (/credit|card/.test(raw)) return PaymentMethod.CREDIT_CARD;
  if (/visa|master|mast|amex|discover/.test(raw)) return PaymentMethod.CREDIT_CARD;
  if (/purchase|po/.test(raw)) return PaymentMethod.PURCHASE_ORDER;
  if (/invoice|check/.test(raw)) return PaymentMethod.INVOICE;
  if (/comp/.test(raw)) return PaymentMethod.COMPED;
  return PaymentMethod.UNKNOWN;
}

function splitName(value: string) {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  return {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "Historical",
    lastName: parts.length > 1 ? parts.at(-1)! : "Presenter"
  };
}

function splitList(value: string) {
  return clean(value).split(/\r?\n|;|\|/).map((item) => clean(item)).filter(Boolean);
}

function parseParticipants(row: CsvRow, mapping: HistoricalImportMapping) {
  const rosterText = value(row, mapping, "participantText");
  if (rosterText) {
    return parseRosterText(rosterText);
  }

  const names = splitList(value(row, mapping, "participantNames"));
  const emails = splitList(value(row, mapping, "participantEmails"));
  const titles = splitList(value(row, mapping, "participantTitles"));
  const participants: ParsedRosterParticipant[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const [index, email] of emails.entries()) {
    const name = splitName(names[index] ?? email.split("@")[0]);
    participants.push({
      firstName: name.firstName,
      lastName: name.lastName,
      email: email.toLowerCase(),
      ...(titles[index] ? { title: titles[index] } : {})
    });
    if (!titles[index]) {
      warnings.push(`Participant ${index + 1} is missing title.`);
    }
  }

  if (names.length > 0 && emails.length === 0) {
    warnings.push("Participant names were present, but no participant emails were mapped; participant records were not created.");
  }

  return { participants, warnings, errors };
}

function parseSessionDates(value: string) {
  return splitList(value)
    .map(parseDateValue)
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.toISOString());
}

function presenterInitials(name: string) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function normalizedSeason(value?: string) {
  const raw = clean(value);
  const match = ["Spring", "Summer", "Fall", "Winter"].find((season) => season.toLowerCase() === raw.toLowerCase());
  return match || raw;
}

function yearFromDate(value?: string) {
  const date = parseDateValue(clean(value));
  return date ? date.getUTCFullYear() : new Date().getUTCFullYear();
}

export function generatedHistoricalCohortShortName(cohort?: HistoricalCohortImportDetails) {
  if (cohort?.shortName) return clean(cohort.shortName);
  const leader = clean(cohort?.presenterShortName) || presenterInitials(clean(cohort?.presenterName));
  const season = normalizedSeason(cohort?.season) || "Historical";
  const year = yearFromDate(cohort?.startDate);
  return [leader, season, year].filter(Boolean).join("-");
}

function normalizeCohortDetails(cohort?: HistoricalCohortImportDetails) {
  const startDate = parseDateValue(clean(cohort?.startDate));
  const endDate = parseDateValue(clean(cohort?.endDate)) ?? startDate;
  return {
    cohortTitle: clean(cohort?.title),
    cohortShortName: generatedHistoricalCohortShortName(cohort),
    presenterId: clean(cohort?.presenterId) || undefined,
    presenterName: clean(cohort?.presenterName),
    presenterEmail: clean(cohort?.presenterEmail) || undefined,
    presenterShortName: clean(cohort?.presenterShortName) || undefined,
    startDate: startDate?.toISOString(),
    endDate: endDate?.toISOString(),
    season: normalizedSeason(cohort?.season) || undefined
  };
}

function hasSingleCohortDetails(cohort?: HistoricalCohortImportDetails) {
  const details = normalizeCohortDetails(cohort);
  return Boolean(details.cohortTitle || details.presenterName || details.startDate || details.season);
}

function isRegistrationStartRow(row: CsvRow, mapping: HistoricalImportMapping) {
  return Boolean(
    value(row, mapping, "organizationAddressLine1") ||
      value(row, mapping, "organizationCity") ||
      value(row, mapping, "organizationState") ||
      value(row, mapping, "organizationZip") ||
      value(row, mapping, "organizationPhone") ||
      value(row, mapping, "participantCount") ||
      value(row, mapping, "totalAmount") ||
      value(row, mapping, "paymentStatus") ||
      value(row, mapping, "invoiceNumber")
  );
}

function participantFromRow(row: CsvRow, mapping: HistoricalImportMapping) {
  const email = value(row, mapping, "primaryContactEmail").toLowerCase();
  const nameValue = value(row, mapping, "primaryContactName") || (email ? email.split("@")[0] : "");
  const name = splitName(nameValue);

  if (!email && !nameValue) {
    return null;
  }

  return {
    firstName: name.firstName,
    lastName: name.lastName,
    email,
    ...(value(row, mapping, "primaryContactTitle") ? { title: value(row, mapping, "primaryContactTitle") } : {}),
    ...(value(row, mapping, "primaryContactPhone") ? { phone: value(row, mapping, "primaryContactPhone") } : {})
  };
}

function isParsedParticipant(value: ReturnType<typeof participantFromRow>): value is ParsedRosterParticipant {
  return Boolean(value?.email);
}

function isMarked(value: string) {
  return ["x", "yes", "true", "1"].includes(normalizedHeader(value));
}

function isPocOnlyRow(row: CsvRow, mapping: HistoricalImportMapping) {
  return isMarked(value(row, mapping, "pocOnlyFlag"));
}

function buildGroupedHistoricalRows(csvText: string, inputMapping: HistoricalImportMapping | undefined, cohort: HistoricalCohortImportDetails) {
  const parsed = parseHistoricalCsv(csvText);
  const suggestedMapping = suggestHistoricalImportMapping(parsed.headers);
  const mapping = { ...suggestedMapping, ...(inputMapping ?? {}) };
  const details = normalizeCohortDetails(cohort);
  const groups: Array<{ start: CsvRow; rows: CsvRow[] }> = [];
  let current: { start: CsvRow; rows: CsvRow[] } | null = null;

  for (const row of parsed.rows) {
    if (isRegistrationStartRow(row, mapping) || !current) {
      current = { start: row, rows: [row] };
      groups.push(current);
    } else {
      current.rows.push(row);
    }
  }

  const rows = groups.map((group) => {
    const startRow = group.start;
    const participants = group.rows
      .filter((row) => !isPocOnlyRow(row, mapping))
      .map((row) => participantFromRow(row, mapping))
      .filter(isParsedParticipant);
    const primary = participantFromRow(startRow, mapping) ?? participants[0];
    const participantCount = parseIntValue(value(startRow, mapping, "participantCount")) || participants.length || 1;
    const fallbackOrganizationName = [primary?.firstName, primary?.lastName].filter(Boolean).join(" ");
    const organizationName = value(startRow, mapping, "organizationName") || fallbackOrganizationName;
    const normalized: NormalizedHistoricalRow & { presenterId?: string } = {
      cohortTitle: details.cohortTitle,
      cohortShortName: details.cohortShortName,
      presenterName: details.presenterName,
      presenterEmail: details.presenterEmail,
      presenterShortName: details.presenterShortName,
      presenterId: details.presenterId,
      startDate: details.startDate,
      endDate: details.endDate,
      season: details.season,
      organizationName,
      organizationAddressLine1: value(startRow, mapping, "organizationAddressLine1") || undefined,
      organizationAddressLine2: value(startRow, mapping, "organizationAddressLine2") || undefined,
      organizationCity: value(startRow, mapping, "organizationCity") || undefined,
      organizationState: normalizeUsStateCode(value(startRow, mapping, "organizationState")) || value(startRow, mapping, "organizationState") || undefined,
      organizationZip: value(startRow, mapping, "organizationZip") || undefined,
      organizationPhone: value(startRow, mapping, "organizationPhone") || undefined,
      primaryContactName: [primary?.firstName, primary?.lastName].filter(Boolean).join(" "),
      primaryContactEmail: primary?.email?.toLowerCase() ?? "",
      primaryContactPhone: primary?.phone || value(startRow, mapping, "primaryContactPhone") || undefined,
      primaryContactTitle: primary?.title || value(startRow, mapping, "primaryContactTitle") || undefined,
      participantCount,
      participants,
      totalAmount: parseMoney(value(startRow, mapping, "totalAmount")),
      paymentStatus: parsePaymentStatus(value(startRow, mapping, "paymentStatus")),
      paymentMethod: parsePaymentMethod(value(startRow, mapping, "paymentMethod") || value(startRow, mapping, "notes")),
      registrationDate: parseDateValue(value(startRow, mapping, "registrationDate"))?.toISOString(),
      invoiceNumber: value(startRow, mapping, "invoiceNumber") || undefined,
      purchaseOrderNumber: value(startRow, mapping, "purchaseOrderNumber") || undefined,
      source: value(startRow, mapping, "source") || undefined,
      utmSource: value(startRow, mapping, "utmSource") || undefined,
      utmCampaign: value(startRow, mapping, "utmCampaign") || undefined,
      notes: value(startRow, mapping, "notes") || undefined,
      sessionDates: parseSessionDates(value(startRow, mapping, "sessionDates"))
    };
    const errors = [
      !normalized.cohortTitle && !normalized.cohortShortName ? "Cohort title or short name is required." : "",
      !normalized.presenterName && !normalized.presenterId ? "Presenter is required." : "",
      !normalized.startDate ? "Cohort start date is required." : "",
      !normalized.organizationName ? "Organization is required." : "",
      !normalized.primaryContactName ? "POC name is required." : "",
      !normalized.primaryContactEmail ? "POC email is required." : "",
      !normalized.participantCount ? "Participant count is required." : ""
    ].filter(Boolean);
    const warnings = [
      !value(startRow, mapping, "organizationName") && fallbackOrganizationName ? "Organization was blank; using the POC name as the organization label." : "",
      normalized.participantCount > 0 && normalized.participants.length > 0 && normalized.participants.length !== normalized.participantCount
        ? `Participant count is ${normalized.participantCount}, but ${normalized.participants.length} participant rows were parsed.`
        : ""
    ].filter(Boolean);

    return {
      rowNumber: startRow.rowNumber,
      raw: {
        ...startRow.raw,
        __groupedRows: group.rows.map((row) => row.rowNumber).join(", ")
      },
      normalized,
      warnings,
      errors
    };
  });
  appendDuplicateWarnings(rows);

  return {
    headers: parsed.headers,
    supportedFields: supportedFields
      .filter((field) => !cohortDetailFields.has(field))
      .map((field) => ({ field, label: fieldLabels[field] })),
    suggestedMapping,
    mapping,
    rows,
    summary: summarizeRows(rows),
    mode: "single_cohort_grouped"
  };
}

function appendDuplicateWarnings(rows: Array<{ rowNumber: number; normalized: NormalizedHistoricalRow; warnings: string[] }>) {
  const seenRegistrationKeys = new Map<string, number>();

  for (const row of rows) {
    const duplicateKey = [
      cohortImportKey(row.normalized),
      row.normalized.primaryContactEmail || slugify(row.normalized.primaryContactName),
      slugify(row.normalized.organizationName),
      row.normalized.invoiceNumber || row.normalized.registrationDate || String(row.normalized.totalAmount)
    ].join("|");
    const firstRowNumber = seenRegistrationKeys.get(duplicateKey);

    if (firstRowNumber) {
      row.warnings.push(`Possible duplicate of CSV row ${firstRowNumber}; import will still create this historical registration.`);
    } else {
      seenRegistrationKeys.set(duplicateKey, row.rowNumber);
    }
  }
}

export function normalizeHistoricalImportRows(csvText: string, inputMapping?: HistoricalImportMapping, cohort?: HistoricalCohortImportDetails) {
  if (hasSingleCohortDetails(cohort)) {
    return buildGroupedHistoricalRows(csvText, inputMapping, cohort!);
  }

  const parsed = parseHistoricalCsv(csvText);
  const suggestedMapping = suggestHistoricalImportMapping(parsed.headers);
  const mapping = { ...suggestedMapping, ...(inputMapping ?? {}) };
  const rows = parsed.rows.map((row) => {
    const participants = parseParticipants(row, mapping);
    const startDate = parseDateValue(value(row, mapping, "startDate"));
    const endDate = parseDateValue(value(row, mapping, "endDate")) ?? startDate;
    const participantCount = parseIntValue(value(row, mapping, "participantCount")) || participants.participants.length;
    const normalized: NormalizedHistoricalRow = {
      cohortTitle: value(row, mapping, "cohortTitle"),
      cohortShortName: value(row, mapping, "cohortShortName") || undefined,
      presenterName: value(row, mapping, "presenterName"),
      presenterEmail: value(row, mapping, "presenterEmail") || undefined,
      presenterShortName: undefined,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
      season: value(row, mapping, "season") || undefined,
      organizationName: value(row, mapping, "organizationName"),
      organizationAddressLine1: value(row, mapping, "organizationAddressLine1") || undefined,
      organizationAddressLine2: value(row, mapping, "organizationAddressLine2") || undefined,
      organizationCity: value(row, mapping, "organizationCity") || undefined,
      organizationState: normalizeUsStateCode(value(row, mapping, "organizationState")) || value(row, mapping, "organizationState") || undefined,
      organizationZip: value(row, mapping, "organizationZip") || undefined,
      organizationPhone: value(row, mapping, "organizationPhone") || undefined,
      primaryContactName: value(row, mapping, "primaryContactName"),
      primaryContactEmail: value(row, mapping, "primaryContactEmail").toLowerCase(),
      primaryContactPhone: value(row, mapping, "primaryContactPhone") || undefined,
      primaryContactTitle: value(row, mapping, "primaryContactTitle") || undefined,
      participantCount,
      participants: participants.participants,
      totalAmount: parseMoney(value(row, mapping, "totalAmount")),
      paymentStatus: parsePaymentStatus(value(row, mapping, "paymentStatus")),
      paymentMethod: parsePaymentMethod(value(row, mapping, "paymentMethod")),
      registrationDate: parseDateValue(value(row, mapping, "registrationDate"))?.toISOString(),
      invoiceNumber: value(row, mapping, "invoiceNumber") || undefined,
      purchaseOrderNumber: value(row, mapping, "purchaseOrderNumber") || undefined,
      source: value(row, mapping, "source") || undefined,
      utmSource: value(row, mapping, "utmSource") || undefined,
      utmCampaign: value(row, mapping, "utmCampaign") || undefined,
      notes: value(row, mapping, "notes") || undefined,
      sessionDates: parseSessionDates(value(row, mapping, "sessionDates"))
    };
    const errors = [
      !normalized.cohortTitle && !normalized.cohortShortName ? "Cohort title or short name is required." : "",
      !normalized.presenterName ? "Presenter is required." : "",
      !normalized.startDate ? "Cohort start date is required." : "",
      !normalized.organizationName ? "Organization is required." : "",
      !normalized.primaryContactName ? "POC name is required." : "",
      !normalized.primaryContactEmail ? "POC email is required." : "",
      !normalized.participantCount ? "Participant count is required." : ""
    ].filter(Boolean);
    const warnings = [
      ...participants.warnings,
      ...participants.errors,
      normalized.organizationState && !normalizeUsStateCode(normalized.organizationState) ? "State could not be normalized to a two-letter code." : "",
      normalized.participantCount > 0 && normalized.participants.length > 0 && normalized.participants.length !== normalized.participantCount
        ? `Participant count is ${normalized.participantCount}, but ${normalized.participants.length} participant rows were parsed.`
        : ""
    ].filter(Boolean);

    return { rowNumber: row.rowNumber, raw: row.raw, normalized, warnings, errors };
  });
  appendDuplicateWarnings(rows);

  return {
    headers: parsed.headers,
    supportedFields: supportedFields.map((field) => ({ field, label: fieldLabels[field] })),
    suggestedMapping,
    mapping,
    rows,
    summary: summarizeRows(rows)
  };
}

function summarizeRows(rows: Array<{ normalized: NormalizedHistoricalRow; warnings: string[]; errors: string[] }>) {
  const cohorts = new Map<string, { title: string; rows: number; registrations: number; participants: number; amount: number }>();
  for (const row of rows) {
    const key = cohortImportKey(row.normalized);
    const existing = cohorts.get(key) ?? {
      title: row.normalized.cohortTitle || row.normalized.cohortShortName || "Untitled cohort",
      rows: 0,
      registrations: 0,
      participants: 0,
      amount: 0
    };
    existing.rows += 1;
    existing.registrations += row.errors.length ? 0 : 1;
    existing.participants += row.normalized.participants.length;
    existing.amount += row.normalized.totalAmount;
    cohorts.set(key, existing);
  }

  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    warningRows: rows.filter((row) => row.warnings.length > 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
    cohorts: Array.from(cohorts.values())
  };
}

function slugify(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "historical-cohort";
}

function cohortImportKey(row: NormalizedHistoricalRow) {
  return [
    slugify(row.cohortShortName || row.cohortTitle),
    row.startDate?.slice(0, 10) ?? "unknown",
    slugify(row.presenterName)
  ].join("|");
}

function presenterEmailFallback(name: string) {
  return `historical-${slugify(name)}@rocketpd.local`;
}

async function findOrCreatePresenter(tx: Prisma.TransactionClient, row: NormalizedHistoricalRow) {
  if (row.presenterId) {
    const byId = await tx.presenter.findUnique({ where: { id: row.presenterId } });
    if (byId) {
      return row.presenterShortName && !byId.shortName
        ? tx.presenter.update({ where: { id: byId.id }, data: { shortName: row.presenterShortName } })
        : byId;
    }
  }

  if (row.presenterEmail) {
    const byEmail = await tx.presenter.findUnique({ where: { email: row.presenterEmail.toLowerCase() } });
    if (byEmail) {
      return row.presenterShortName && !byEmail.shortName
        ? tx.presenter.update({ where: { id: byEmail.id }, data: { shortName: row.presenterShortName } })
        : byEmail;
    }
  }

  const name = splitName(row.presenterName);
  const byName = await tx.presenter.findFirst({
    where: {
      firstName: { equals: name.firstName, mode: "insensitive" },
      lastName: { equals: name.lastName, mode: "insensitive" }
    }
  });
  if (byName) {
    return row.presenterShortName && !byName.shortName
      ? tx.presenter.update({ where: { id: byName.id }, data: { shortName: row.presenterShortName } })
      : byName;
  }

  return tx.presenter.create({
    data: {
      firstName: name.firstName,
      lastName: name.lastName,
      email: row.presenterEmail?.toLowerCase() || presenterEmailFallback(row.presenterName),
      shortName: row.presenterShortName,
      active: false,
      notes: "Created by historical CSV import."
    }
  });
}

async function findOrCreateCohort(tx: Prisma.TransactionClient, row: NormalizedHistoricalRow, presenterId: string) {
  const start = new Date(row.startDate!);
  const end = row.endDate ? new Date(row.endDate) : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const title = row.cohortTitle || row.cohortShortName || "Historical Cohort";
  const baseSlug = slugify(`${row.cohortShortName || title}-${start.getUTCFullYear()}`);
  const cohortMatches: Prisma.CohortWhereInput[] = [
    { slug: baseSlug },
    { title: { equals: title, mode: "insensitive" } }
  ];

  if (row.cohortShortName) {
    cohortMatches.push({ shortName: { equals: row.cohortShortName, mode: "insensitive" } });
  }

  const existing = await tx.cohort.findFirst({
    where: {
      presenterId,
      OR: cohortMatches
    }
  });
  if (existing) return existing;

  let slug = baseSlug;
  let suffix = 2;
  while (await tx.cohort.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return tx.cohort.create({
    data: {
      title,
      shortName: row.cohortShortName,
      slug,
      presenterId,
      description: row.season ? `Historical import: ${row.season}` : "Historical import.",
      status: CohortStatus.COMPLETED,
      startDate: start,
      endDate: safeEnd,
      cohortType: CohortType.LIVE_VIRTUAL,
      defaultTimezone: "America/New_York",
      pricePerParticipant: row.participantCount ? row.totalAmount / row.participantCount : 0,
      publicRegistrationEnabled: false,
      quickBooksSyncStatus: SyncStatus.NOT_SYNCED
    }
  });
}

async function createHistoricalSessions(tx: Prisma.TransactionClient, cohortId: string, row: NormalizedHistoricalRow) {
  if (row.sessionDates.length === 0) return 0;
  let created = 0;
  for (const [index, iso] of row.sessionDates.entries()) {
    const start = new Date(iso);
    const sessionNumber = index + 1;
    const existing = await tx.cohortSession.findUnique({
      where: { cohortId_sessionNumber: { cohortId, sessionNumber } }
    });
    if (existing) continue;
    await tx.cohortSession.create({
      data: {
        cohortId,
        title: `Session ${sessionNumber}`,
        sessionNumber,
        startTime: start,
        endTime: new Date(start.getTime() + 90 * 60 * 1000),
        timezone: "America/New_York",
        calendarInviteStatus: CalendarInviteStatus.NOT_CREATED
      }
    });
    created += 1;
  }
  return created;
}

async function findOrCreateOrganization(tx: Prisma.TransactionClient, row: NormalizedHistoricalRow) {
  const existing = await tx.organization.findFirst({
    where: {
      name: { equals: row.organizationName, mode: "insensitive" },
      city: row.organizationCity ? { equals: row.organizationCity, mode: "insensitive" } : undefined,
      state: row.organizationState ? { equals: row.organizationState, mode: "insensitive" } : undefined
    }
  });
  if (existing) return existing;

  return tx.organization.create({
    data: {
      name: row.organizationName,
      type: OrganizationType.DISTRICT,
      addressLine1: row.organizationAddressLine1,
      addressLine2: row.organizationAddressLine2,
      city: row.organizationCity,
      state: row.organizationState,
      zip: row.organizationZip,
      phone: row.organizationPhone,
      notes: "Created by historical CSV import."
    }
  });
}

function registrationStatusForHistoricalRow(row: NormalizedHistoricalRow) {
  return row.paymentStatus === PaymentStatus.CANCELLED || row.paymentStatus === PaymentStatus.REFUNDED
    ? RegistrationStatus.CANCELLED
    : RegistrationStatus.COMPLETED;
}

export async function previewHistoricalImport(input: { csvText: string; mapping?: HistoricalImportMapping; cohort?: HistoricalCohortImportDetails }) {
  return normalizeHistoricalImportRows(input.csvText, input.mapping, input.cohort);
}

export async function listHistoricalImports() {
  return prisma.historicalImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { createdBy: true, rows: { orderBy: { rowNumber: "asc" }, take: 10 } }
  });
}

export async function importHistoricalCsv(input: {
  csvText: string;
  fileName: string;
  mapping?: HistoricalImportMapping;
  cohort?: HistoricalCohortImportDetails;
  createdById?: string;
}) {
  const preview = normalizeHistoricalImportRows(input.csvText, input.mapping, input.cohort);
  const importableRows = preview.rows.filter((row) => row.errors.length === 0);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.historicalImportBatch.create({
      data: {
        fileName: input.fileName,
        mappingJson: preview.mapping as Prisma.InputJsonValue,
        status: "IMPORTING",
        totalRows: preview.summary.totalRows,
        validRows: preview.summary.validRows,
        warningRows: preview.summary.warningRows,
        errorRows: preview.summary.errorRows,
        createdById: input.createdById
      }
    });
    const entityCounts = { cohorts: new Set<string>(), registrations: 0, participants: 0, payments: 0 };
    const cohortSessionKeys = new Set<string>();

    for (const row of preview.rows) {
      if (row.errors.length > 0) {
        await tx.historicalImportRow.create({
          data: {
            batchId: batch.id,
            rowNumber: row.rowNumber,
            rawRowJson: row.raw as Prisma.InputJsonValue,
            normalizedJson: row.normalized as unknown as Prisma.InputJsonValue,
            warningsJson: row.warnings as Prisma.InputJsonValue,
            errorsJson: row.errors as Prisma.InputJsonValue
          }
        });
        continue;
      }

      const presenter = await findOrCreatePresenter(tx, row.normalized);
      const cohort = await findOrCreateCohort(tx, row.normalized, presenter.id);
      entityCounts.cohorts.add(cohort.id);
      const sessionKey = `${cohort.id}:${row.normalized.sessionDates.join("|")}`;
      if (!cohortSessionKeys.has(sessionKey)) {
        await createHistoricalSessions(tx, cohort.id, row.normalized);
        cohortSessionKeys.add(sessionKey);
      }
      const organization = await findOrCreateOrganization(tx, row.normalized);
      const participantListStatus = row.normalized.participants.length > 0 && row.normalized.participants.length >= row.normalized.participantCount
        ? ParticipantListStatus.COMPLETE
        : ParticipantListStatus.NOT_REQUESTED;
      const registration = await tx.registration.create({
        data: {
          cohortId: cohort.id,
          organizationId: organization.id,
          primaryContactName: row.normalized.primaryContactName,
          primaryContactEmail: row.normalized.primaryContactEmail,
          primaryContactPhone: row.normalized.primaryContactPhone,
          primaryContactTitle: row.normalized.primaryContactTitle,
          billingContactName: row.normalized.primaryContactName,
          billingContactEmail: row.normalized.primaryContactEmail,
          paymentMethod: row.normalized.paymentMethod,
          paymentStatus: row.normalized.paymentStatus,
          invoiceNumber: row.normalized.invoiceNumber,
          purchaseOrderNumber: row.normalized.purchaseOrderNumber,
          participantListStatus,
          totalAmount: row.normalized.totalAmount,
          participantCount: row.normalized.participantCount,
          status: registrationStatusForHistoricalRow(row.normalized),
          source: row.normalized.source || "historical_import",
          utmSource: row.normalized.utmSource,
          utmCampaign: row.normalized.utmCampaign,
          externalSource: "historical_import",
          externalSubmissionId: `${batch.id}:${row.rowNumber}`,
          notes: [row.normalized.notes, "Historical import: data-only closed cohort record."].filter(Boolean).join("\n"),
          createdAt: row.normalized.registrationDate ? new Date(row.normalized.registrationDate) : undefined
        }
      });
      entityCounts.registrations += 1;

      for (const participant of row.normalized.participants) {
        await tx.participant.create({
          data: {
            registrationId: registration.id,
            cohortId: cohort.id,
            organizationId: organization.id,
            firstName: participant.firstName,
            lastName: participant.lastName,
            email: participant.email,
            title: participant.title,
            phone: participant.phone,
            status: ParticipantStatus.COMPLETED
          }
        });
        entityCounts.participants += 1;
      }

      if (row.normalized.totalAmount > 0) {
        await tx.paymentRecord.create({
          data: {
            registrationId: registration.id,
            cohortId: cohort.id,
            organizationId: organization.id,
            amount: row.normalized.totalAmount,
            status: row.normalized.paymentStatus,
            method: row.normalized.paymentMethod,
            invoiceNumber: row.normalized.invoiceNumber,
            paymentDate: row.normalized.registrationDate
              ? new Date(row.normalized.registrationDate)
              : row.normalized.endDate
                ? new Date(row.normalized.endDate)
                : undefined,
            notes: "Historical import payment record.",
            createdAt: row.normalized.registrationDate ? new Date(row.normalized.registrationDate) : undefined
          }
        });
        entityCounts.payments += 1;
      }

      await tx.historicalImportRow.create({
        data: {
          batchId: batch.id,
          rowNumber: row.rowNumber,
          rawRowJson: row.raw as Prisma.InputJsonValue,
          normalizedJson: row.normalized as unknown as Prisma.InputJsonValue,
          warningsJson: row.warnings as Prisma.InputJsonValue,
          errorsJson: [] as Prisma.InputJsonValue,
          importedEntityIdsJson: {
            cohortId: cohort.id,
            registrationId: registration.id,
            organizationId: organization.id
          } as Prisma.InputJsonValue
        }
      });
    }

    const completed = await tx.historicalImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "IMPORTED",
        completedAt: new Date(),
        importedCohorts: entityCounts.cohorts.size,
        importedRegistrations: entityCounts.registrations,
        importedParticipants: entityCounts.participants,
        importedPayments: entityCounts.payments
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } }
    });

    return { batch: completed, preview, importedRows: importableRows.length };
  });
}
