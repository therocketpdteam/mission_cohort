export function ensureDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function isAfter(start: string | Date, end: string | Date) {
  return ensureDate(end).getTime() > ensureDate(start).getTime();
}

export function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}
