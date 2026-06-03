export type DashboardDatePreset =
  | "NEXT_WEEK"
  | "NEXT_MONTH"
  | "NEXT_YEAR"
  | "PAST_WEEK"
  | "PAST_MONTH"
  | "PAST_YEAR"
  | "CUSTOM";

export type DashboardDateRangeState = {
  preset: DashboardDatePreset;
  customStart: string;
  customEnd: string;
};

export const DASHBOARD_DATE_RANGE_STORAGE_KEY = "mission-dashboard-date-range";

export const dashboardDatePresetOptions: ReadonlyArray<{ value: DashboardDatePreset; label: string }> = [
  { value: "NEXT_WEEK", label: "Next week" },
  { value: "NEXT_MONTH", label: "Next month" },
  { value: "NEXT_YEAR", label: "Next year" },
  { value: "PAST_WEEK", label: "Past week" },
  { value: "PAST_MONTH", label: "Past month" },
  { value: "PAST_YEAR", label: "Past year" },
  { value: "CUSTOM", label: "Custom" }
];

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(value: Date, months: number) {
  const next = new Date(value);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(value: Date, years: number) {
  const next = new Date(value);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function toInputDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromInputDate(value: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

export function createDefaultDashboardDateRangeState(now = new Date()): DashboardDateRangeState {
  const start = startOfLocalDay(now);
  const end = addMonths(start, 1);

  return {
    preset: "NEXT_MONTH",
    customStart: toInputDate(start),
    customEnd: toInputDate(addDays(end, -1))
  };
}

export function resolveDashboardDateRange(state: DashboardDateRangeState, now = new Date()) {
  const today = startOfLocalDay(now);

  if (state.preset === "CUSTOM") {
    const customStart = fromInputDate(state.customStart);
    const customEnd = fromInputDate(state.customEnd);

    if (!customStart || !customEnd) {
      return null;
    }

    const start = customStart <= customEnd ? customStart : customEnd;
    const end = addDays(customStart <= customEnd ? customEnd : customStart, 1);

    return { start, end };
  }

  if (state.preset === "NEXT_WEEK") {
    return { start: today, end: addDays(today, 7) };
  }

  if (state.preset === "NEXT_MONTH") {
    return { start: today, end: addMonths(today, 1) };
  }

  if (state.preset === "NEXT_YEAR") {
    return { start: today, end: addYears(today, 1) };
  }

  if (state.preset === "PAST_WEEK") {
    return { start: addDays(today, -7), end: today };
  }

  if (state.preset === "PAST_MONTH") {
    return { start: addMonths(today, -1), end: today };
  }

  return { start: addYears(today, -1), end: today };
}

export function dateRangeToCustomInputs(state: DashboardDateRangeState, now = new Date()) {
  const range = resolveDashboardDateRange(state, now);
  if (!range) {
    return { customStart: state.customStart, customEnd: state.customEnd };
  }

  return {
    customStart: toInputDate(range.start),
    customEnd: toInputDate(addDays(range.end, -1))
  };
}

export function parseDashboardDateRangeState(raw: string | null, now = new Date()) {
  if (!raw) {
    return createDefaultDashboardDateRangeState(now);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DashboardDateRangeState>;
    const presets = new Set(dashboardDatePresetOptions.map((option) => option.value));

    if (!parsed.preset || !presets.has(parsed.preset)) {
      return createDefaultDashboardDateRangeState(now);
    }

    const fallback = createDefaultDashboardDateRangeState(now);
    return {
      preset: parsed.preset,
      customStart: parsed.customStart || fallback.customStart,
      customEnd: parsed.customEnd || fallback.customEnd
    };
  } catch {
    return createDefaultDashboardDateRangeState(now);
  }
}

export function dashboardDateRangeSearchParams(state: DashboardDateRangeState) {
  const range = resolveDashboardDateRange(state);
  const params = new URLSearchParams({ rangePreset: state.preset });

  if (range) {
    params.set("rangeStart", range.start.toISOString());
    params.set("rangeEnd", range.end.toISOString());
  }

  return params.toString();
}
