function parseDateTimeInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0)
  };
}

function dateTimePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second)
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = dateTimePartsInZone(date, timeZone);
  const zoneAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zoneAsUtc - date.getTime();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function dateToDateTimeInputInZone(value: unknown, timeZone?: string | null) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  if (!timeZone) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  }

  try {
    const parts = dateTimePartsInZone(date, timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  } catch {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  }
}

export function dateToDateInput(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

export function dateTimeInputInZoneToIso(value: unknown, timeZone?: string | null) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (!timeZone || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  const parsed = parseDateTimeInput(String(value));
  if (!parsed) {
    const fallbackDate = new Date(String(value));
    return Number.isNaN(fallbackDate.getTime()) ? value : fallbackDate.toISOString();
  }

  try {
    let utcMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
    utcMs -= timeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs -= timeZoneOffsetMs(new Date(utcMs), timeZone) - timeZoneOffsetMs(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second)), timeZone);

    return new Date(utcMs).toISOString();
  } catch {
    const fallbackDate = new Date(String(value));
    return Number.isNaN(fallbackDate.getTime()) ? value : fallbackDate.toISOString();
  }
}

export function formatDateInZone(
  value: unknown,
  timeZone?: string | null,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
}

export function formatTimeInZone(value: unknown, timeZone?: string | null) {
  return formatDateInZone(value, timeZone, { hour: "numeric", minute: "2-digit" });
}

export function formatDateTimeInZone(value: unknown, timeZone?: string | null) {
  return formatDateInZone(value, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
