export type ReminderScheduleItem = {
  type: "WEEK_BEFORE_REMINDER" | "DAY_BEFORE_REMINDER" | "HOUR_BEFORE_REMINDER";
  scheduledFor: Date;
};

export function generateSessionReminderSchedule(session: { startTime: Date | string }) {
  const start = session.startTime instanceof Date ? session.startTime : new Date(session.startTime);

  return [
    {
      type: "WEEK_BEFORE_REMINDER" as const,
      scheduledFor: new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
    },
    {
      type: "DAY_BEFORE_REMINDER" as const,
      scheduledFor: new Date(start.getTime() - 24 * 60 * 60 * 1000)
    },
    {
      type: "HOUR_BEFORE_REMINDER" as const,
      scheduledFor: new Date(start.getTime() - 60 * 60 * 1000)
    }
  ];
}
