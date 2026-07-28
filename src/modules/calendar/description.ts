type CalendarDescriptionSession = {
  title?: string | null;
  description?: string | null;
  meetingUrl?: string | null;
};

type CalendarDescriptionCohort = {
  title?: string | null;
  presenterName?: string | null;
  description?: string | null;
};

function clean(value?: string | null) {
  return String(value ?? "").trim();
}

export function buildSessionCalendarDescription(input: {
  session: CalendarDescriptionSession;
  cohort?: CalendarDescriptionCohort | null;
}) {
  const sessionTitle = clean(input.session.title);
  const sessionDescription = clean(input.session.description);
  const cohortTitle = clean(input.cohort?.title);
  const presenterName = clean(input.cohort?.presenterName);
  const cohortDescription = clean(input.cohort?.description);
  const meetingUrl = clean(input.session.meetingUrl);
  const lines = [
    cohortTitle ? `Cohort: ${cohortTitle}` : "",
    sessionTitle ? `Session: ${sessionTitle}` : "",
    presenterName ? `Presenter: ${presenterName}` : "",
    "",
    sessionDescription || cohortDescription,
    "",
    meetingUrl ? `Join Zoom: ${meetingUrl}` : "",
    "Questions? Email info@rocketpd.com."
  ].filter((line, index, rows) => line || (rows[index - 1] && rows[index + 1]));

  return lines.join("\n").trim();
}
