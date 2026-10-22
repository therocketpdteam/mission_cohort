import { prisma } from "@/lib/prisma";
import { backgroundJobsAllowed } from "@/lib/env";

export type DashboardHealthCheck = { key: string; label: string; status: "healthy" | "warning" | "error" | "unknown"; detail: string; href: string };

export async function dashboardHealth(client = prisma, now = new Date(), jobsEnabled = backgroundJobsAllowed()) {
  const stale = new Date(now.getTime() - 15 * 60_000);
  const results = await Promise.allSettled([
    client.auditLog.findFirst({ where: { entityType: "BackgroundJob", entityId: "send-scheduled-communications", action: "background_job.invoked" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    client.cohortCommunication.count({ where: { status: "SCHEDULED", scheduledFor: { lt: stale }, cohort: { status: "PUBLISHED" } } }),
    client.integrationSyncJob.count({ where: { status: "FAILED" } }),
    client.appSetting.findMany({ where: { key: { startsWith: "cohort.staffCalendar." }, value: { path: ["status"], equals: "failed" } }, select: { key: true } })
  ]);
  const checks: DashboardHealthCheck[] = [];
  const heartbeat = results[0];
  if (!jobsEnabled) checks.push({ key: "jobs", label: "Background jobs paused", status: "warning", detail: "Automatic jobs are disabled in this environment.", href: "/settings?tab=health" });
  else if (heartbeat.status === "rejected") checks.push({ key: "jobs", label: "Scheduler status unavailable", status: "unknown", detail: "The scheduler heartbeat could not be checked.", href: "/settings?tab=health" });
  else {
    const last = heartbeat.value?.createdAt;
    const recent = !!last && last >= stale;
    checks.push({ key: "jobs", label: recent ? "Scheduler recently reached the app" : "Scheduler needs attention", status: recent ? "healthy" : "warning", detail: last ? `Last contact ${Math.max(0, Math.floor((now.getTime() - last.getTime()) / 60_000))} minutes ago. This confirms contact, not completion of every job.` : "No recent scheduler contact has been recorded.", href: "/settings?tab=health" });
  }
  const queue = results[1];
  checks.push(queue.status === "fulfilled"
    ? { key: "queue", label: queue.value ? `${queue.value} overdue scheduled email${queue.value === 1 ? "" : "s"}` : "No overdue scheduled emails", status: queue.value ? "warning" : "healthy", detail: "Published-cohort messages more than 15 minutes past their scheduled time.", href: "/communications" }
    : { key: "queue", label: "Delivery queue unavailable", status: "unknown", detail: "The delivery queue could not be checked.", href: "/communications" });
  const failed = results[2];
  checks.push(failed.status === "fulfilled"
    ? { key: "work", label: failed.value ? `${failed.value} failed background job${failed.value === 1 ? "" : "s"}` : "No failed background jobs", status: failed.value ? "error" : "healthy", detail: "Includes registration delivery and integration jobs requiring review.", href: "/settings?tab=health" }
    : { key: "work", label: "Background work unavailable", status: "unknown", detail: "Background job failures could not be checked.", href: "/settings?tab=health" });
  const calendar = results[3];
  if (calendar.status === "fulfilled" && calendar.value.length) checks.push({ key: "calendar", label: `${calendar.value.length} cohort calendar sync${calendar.value.length === 1 ? "" : "s"} need review`, status: "error", detail: "Open the cohort’s Support Team section to review or retry calendar sync.", href: `/cohorts/${calendar.value[0].key.slice("cohort.staffCalendar.".length)}` });
  else if (calendar.status === "rejected") checks.push({ key: "calendar", label: "Calendar sync status unavailable", status: "unknown", detail: "Calendar sync failures could not be checked.", href: "/cohorts" });
  return { generatedAt: now.toISOString(), checks };
}
