export function uniqueCalendarAttendees(rows: Array<{ email?: string | null; displayName?: string | null }>) {
  const attendees = new Map<string, { email: string; displayName?: string }>();

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || attendees.has(email)) {
      continue;
    }

    attendees.set(email, {
      email,
      ...(row.displayName?.trim() ? { displayName: row.displayName.trim() } : {})
    });
  }

  return [...attendees.values()];
}
