import { activeEmailIssues } from "./emailIssueState";

type Row = Record<string, any>;

export function dashboardOperationalRows(tasks: Row[], upcomingSessions: Row[] = []) {
  const groups = new Map<string, Row>();
  for (const task of tasks) {
    if (!["OPEN", "IN_PROGRESS"].includes(task.status)) continue;
    const id = task.cohortId ?? task.cohort?.id ?? "operations";
    const group = groups.get(id) ?? {
      cohort: task.cohort ?? { id, title: "Operations" }, tasks: [],
      nextSession: upcomingSessions.find((session) => session.cohortId === id)
    };
    group.tasks.push(task);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.tasks.length - a.tasks.length);
}

export function registrationLinePoints(counts: number[]) {
  const max = Math.max(1, ...counts);
  return counts.map((count, index) => ({ x: counts.length <= 1 ? 50 : 5 + index / (counts.length - 1) * 90, y: 90 - count / max * 70, count }));
}

export function unresolvedDeliveryRecipients<T extends Row>(failures: T[], recoveries: Row[]) {
  const key = (event: Row) => `${event.communicationId ?? `${event.provider}:${event.providerMessageId ?? "unlinked"}`}:${String(event.recipientEmail ?? "").trim().toLowerCase()}`;
  const grouped = new Map<string, Row[]>();
  for (const event of recoveries) grouped.set(key(event), [...(grouped.get(key(event)) ?? []), event]);
  const seen = new Set<string>();
  return failures.filter((event) => {
    const identity = key(event);
    if (seen.has(identity) || !activeEmailIssues([event, ...(grouped.get(identity) ?? [])]).length) return false;
    seen.add(identity); return true;
  });
}
