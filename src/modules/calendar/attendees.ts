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

export type CalendarGuest = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  comment?: string;
  additionalGuests?: number;
  resource?: boolean;
  organizer?: boolean;
  self?: boolean;
  id?: string;
};

// Change only staff membership. Existing guest properties and RSVP responses
// survive; removing a staff role cannot remove an active learner or organizer.
export function planStaffCalendarGuests(input: {
  current: CalendarGuest[];
  staff: Array<{ email: string; displayName?: string }>;
  previouslyManaged: string[];
  enrolledEmails: string[];
  organizerEmail?: string;
}) {
  const normalize = (value?: string) => (value ?? "").trim().toLowerCase();
  if (input.current.some((guest) => !normalize(guest.email))) throw new Error("A complete calendar guest list is required.");
  const staff = uniqueCalendarAttendees(input.staff);
  const desired = new Set(staff.map((guest) => guest.email));
  const previous = new Set(input.previouslyManaged.map(normalize));
  const protectedEmails = new Set([...input.enrolledEmails.map(normalize), normalize(input.organizerEmail)]);
  const removed: string[] = [];
  const attendees = input.current.flatMap((guest) => {
    const email = normalize(guest.email);
    if (previous.has(email) && !desired.has(email) && !protectedEmails.has(email) && !guest.organizer) {
      removed.push(email); return [];
    }
    const { organizer: _organizer, self: _self, id: _id, ...writable } = guest;
    return [{ ...writable, email: guest.email! }];
  });
  const present = new Set(attendees.map((guest) => normalize(guest.email)));
  const added = staff.filter((guest) => !present.has(guest.email));
  attendees.push(...added.map((guest) => ({ ...guest, responseStatus: "needsAction" })));
  return { attendees, added: added.map((guest) => guest.email), removed };
}
