import { dateTimeInputInZoneToIso } from "./timezones";

export const REGISTRATION_ACTIVITY_WEEKS = 10;
export const REGISTRATION_ACTIVITY_TIME_ZONE = "America/New_York";
const dayMs = 24 * 60 * 60 * 1000;

export type RegistrationActivity = {
  from: string;
  through: string;
  timeZone: string;
  total: number;
  buckets: Array<{ weekStart: string; weekEnd: string; label: string; count: number; currentWeek: boolean }>;
};

function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REGISTRATION_ACTIVITY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// UTC here represents a calendar date, not the registration timestamp. Calendar
// day arithmetic keeps week boundaries stable across daylight-saving changes.
function mondayFor(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date;
}

export function registrationActivityWindow(now = new Date()) {
  const currentWeek = mondayFor(localDateKey(now));
  const firstWeek = new Date(currentWeek.getTime() - (REGISTRATION_ACTIVITY_WEEKS - 1) * 7 * dayMs);
  const startKey = firstWeek.toISOString().slice(0, 10);
  return {
    start: new Date(String(dateTimeInputInZoneToIso(`${startKey}T00:00`, REGISTRATION_ACTIVITY_TIME_ZONE))),
    end: new Date(now),
    firstWeek
  };
}

export function buildRegistrationActivity(rows: Array<{ createdAt?: Date | string | null }>, now = new Date()): RegistrationActivity {
  const window = registrationActivityWindow(now);
  const buckets = Array.from({ length: REGISTRATION_ACTIVITY_WEEKS }, (_, index) => {
    const week = new Date(window.firstWeek.getTime() + index * 7 * dayMs);
    return {
      weekStart: week.toISOString().slice(0, 10),
      weekEnd: new Date(week.getTime() + 6 * dayMs).toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(week),
      count: 0,
      currentWeek: index === REGISTRATION_ACTIVITY_WEEKS - 1
    };
  });
  const byWeek = new Map(buckets.map((bucket) => [bucket.weekStart, bucket]));
  for (const row of rows) {
    if (!row.createdAt) continue;
    const date = new Date(row.createdAt);
    if (!Number.isFinite(date.getTime()) || date < window.start || date >= window.end) continue;
    const bucket = byWeek.get(mondayFor(localDateKey(date)).toISOString().slice(0, 10));
    if (bucket) bucket.count += 1;
  }
  return {
    from: window.start.toISOString(), through: window.end.toISOString(), timeZone: REGISTRATION_ACTIVITY_TIME_ZONE,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0), buckets
  };
}
