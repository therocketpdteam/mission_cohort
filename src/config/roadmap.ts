export type RoadmapStatus = "done" | "in_progress" | "planned" | "blocked";

export type RoadmapItem = {
  title: string;
  status: RoadmapStatus;
  note?: string;
  priority?: "high" | "medium" | "low";
  ownerArea?: string;
};

export type RoadmapCard = {
  id: string;
  title: string;
  summary: string;
  ownerArea: string;
  nextAction: string;
  items: RoadmapItem[];
};

export type RoadmapCardSummary = RoadmapCard & {
  completion: number;
  visualStatus: "green" | "yellow" | "red";
  counts: Record<RoadmapStatus, number>;
};

export type RoadmapSummary = {
  overallCompletion: number;
  totalItems: number;
  counts: Record<RoadmapStatus, number>;
  cards: RoadmapCardSummary[];
};

const statusWeight: Record<RoadmapStatus, number> = {
  done: 1,
  in_progress: 0.5,
  planned: 0,
  blocked: 0
};

const emptyCounts: Record<RoadmapStatus, number> = {
  done: 0,
  in_progress: 0,
  planned: 0,
  blocked: 0
};

export const roadmapCards: RoadmapCard[] = [
  {
    id: "ui-ux-foundation",
    title: "UI / UX Foundation",
    summary: "The shared visual system, density, table behavior, and mode controls that make Mission Control feel tidy and modern.",
    ownerArea: "Product UI",
    nextAction: "Keep applying the shared table/filter/dropdown rules to older admin surfaces.",
    items: [
      { title: "MUI removal", status: "done", note: "App-native primitives are now the base UI layer.", priority: "high" },
      { title: "Native component system", status: "done", note: "Shared buttons, tables, modals, chips, filters, and drawers are in use.", priority: "high" },
      { title: "DM Sans", status: "done", note: "Global app typography is standardized.", priority: "medium" },
      { title: "Compact mode", status: "done", note: "Density toggle is available for operational screens.", priority: "medium" },
      { title: "Dark mode", status: "in_progress", note: "Core surfaces work; continue contrast passes on newer UI.", priority: "medium" },
      { title: "Table and filter consistency", status: "in_progress", note: "Primary pages use shared patterns; continue cleanup on edge workflows.", priority: "high" },
      { title: "Remaining page polish", status: "planned", note: "Forms, settings subflows, and secondary reports need the same standard.", priority: "medium" }
    ]
  },
  {
    id: "dashboard-command-center",
    title: "Dashboard Command Center",
    summary: "At-a-glance operational health: what is healthy, what needs attention, and where admins act first.",
    ownerArea: "Operations",
    nextAction: "Use live audit results to tune attention items and remove false-positive visual findings.",
    items: [
      { title: "KPI/date filter layer", status: "done", note: "Dashboard snapshots support persisted date presets.", priority: "high" },
      { title: "Cohort readiness", status: "done", note: "Readiness rows highlight cohort operations and blockers.", priority: "high" },
      { title: "Agenda", status: "done", note: "Upcoming sessions are shown as agenda rows.", priority: "medium" },
      { title: "Revenue watch", status: "in_progress", note: "Finance summary exists; production finance migration must be completed.", priority: "high" },
      { title: "Attention items", status: "in_progress", note: "Communications and operations issues are surfaced, but need tighter triage rules.", priority: "medium" },
      { title: "Playwright visual audit coverage", status: "in_progress", note: "Audit exists and can run against prod; reporting is being refined.", priority: "high" }
    ]
  },
  {
    id: "cohorts-operations",
    title: "Cohorts Operations",
    summary: "The flagship workflow for creating, preparing, delivering, and reviewing cohorts.",
    ownerArea: "Cohorts",
    nextAction: "Finish production finance migration and keep simplifying cohort detail rows/actions.",
    items: [
      { title: "Lifecycle statuses", status: "done", note: "Operational status derives from readiness and session dates.", priority: "high" },
      { title: "Cohort thumbnails", status: "done", note: "Thumbnails upload and appear in cohort/dashboard contexts.", priority: "medium" },
      { title: "Overview/readiness", status: "done", note: "Basics and readiness are centered in Overview.", priority: "high" },
      { title: "Sessions checklist", status: "in_progress", note: "Checklist exists; material/session attachment flow needs final polish.", priority: "high" },
      { title: "Registration/participant quick views", status: "in_progress", note: "Rows are clickable; history and edit affordances continue to improve.", priority: "high" },
      { title: "Materials/session resources", status: "planned", note: "Needs a clear attachment-to-email flow.", priority: "medium" },
      { title: "Publish-readiness workflow", status: "in_progress", note: "Checklist exists; automation and completion rules need tightening.", priority: "high" }
    ]
  },
  {
    id: "jotform-intake",
    title: "Jotform Intake",
    summary: "Webhook intake, review, mapping, replay, payment parsing, and submission history.",
    ownerArea: "Integrations",
    nextAction: "Apply production migration, then restore full revision metadata in the review queue.",
    items: [
      { title: "Webhook connection", status: "done", note: "Protected webhook URL and secret rotation are available.", priority: "high" },
      { title: "Review queue", status: "in_progress", note: "Queue is restored using legacy-safe fields until migration lands.", priority: "high" },
      { title: "Mapping wizard", status: "in_progress", note: "Cleaner UI exists; keep removing provider noise and ambiguous fields.", priority: "high" },
      { title: "URL routing", status: "in_progress", note: "URL rules and single-route fallback exist; shared-form edge cases remain.", priority: "high" },
      { title: "Replay", status: "done", note: "Held submissions can be replayed after mapping.", priority: "high" },
      { title: "Payment mapping", status: "done", note: "Explicit payment status and amount mapping are handled.", priority: "high" },
      { title: "Revision/history support", status: "blocked", note: "Code is present, but production DB migration must be applied.", priority: "high" },
      { title: "Remaining routing edge cases", status: "planned", note: "Need clearer handling when Jotform sends generic source URLs.", priority: "medium" }
    ]
  },
  {
    id: "registrations-roster",
    title: "Registrations / Roster",
    summary: "Registration work queues, participant context, roster follow-up, and bulk operations.",
    ownerArea: "Operations",
    nextAction: "Deepen POC timeline and participant history inside quick views.",
    items: [
      { title: "Registration quick view", status: "in_progress", note: "Primary rows open detail; supporting data still needs cleanup.", priority: "high" },
      { title: "POC communication context", status: "planned", note: "Outbound history is planned for registration-side context.", priority: "high" },
      { title: "Roster/payment filters", status: "in_progress", note: "Core filters exist; continue standardizing across views.", priority: "medium" },
      { title: "Participant history", status: "planned", note: "Match by email across cohorts for context.", priority: "medium" },
      { title: "Bulk actions", status: "in_progress", note: "Participant bulk controls exist; expand to registration operations.", priority: "medium" },
      { title: "Attachments", status: "planned", note: "Needs private storage flow connected to communications.", priority: "medium" }
    ]
  },
  {
    id: "communications",
    title: "Communications",
    summary: "Email templates, scheduled/manual sends, delivery telemetry, and message issue visibility.",
    ownerArea: "Communications",
    nextAction: "Connect outbound attachments and make failed/bounced items easier to act on.",
    items: [
      { title: "Templates", status: "done", note: "Template management exists.", priority: "high" },
      { title: "Scheduled/manual emails", status: "in_progress", note: "Scheduling and manual send flows exist, with more polish needed.", priority: "high" },
      { title: "SendGrid delivery/open/error telemetry", status: "in_progress", note: "Events can be recorded and surfaced.", priority: "high" },
      { title: "Dashboard issue surfacing", status: "in_progress", note: "Failed/bounced items appear in operational attention areas.", priority: "medium" },
      { title: "Outbound attachments", status: "planned", note: "Storage support exists; email attachment flow is next.", priority: "high" },
      { title: "Future inbound reply sync", status: "planned", note: "Explicitly future scope.", priority: "low" }
    ]
  },
  {
    id: "finance-distribution",
    title: "Finance / Distribution",
    summary: "Payments, invoice drafts, receipts, TL distribution, and project return visibility.",
    ownerArea: "Finance",
    nextAction: "Apply the finance migration in production so invoice/distribution endpoints stop returning 500.",
    items: [
      { title: "Payment snapshot", status: "done", note: "Payment summary is available on dashboard/cohort surfaces.", priority: "high" },
      { title: "Invoice drafts", status: "blocked", note: "Code exists; production finance tables need migration.", priority: "high" },
      { title: "PDF invoices/receipts", status: "blocked", note: "Generation exists but depends on invoice tables and storage readiness.", priority: "high" },
      { title: "QuickBooks reference sync", status: "planned", note: "References/status are the v1 sync target.", priority: "medium" },
      { title: "Distribution calculator", status: "blocked", note: "Code exists; production distribution table needs migration.", priority: "high" },
      { title: "Payout ledger", status: "blocked", note: "Depends on distribution payout table in production.", priority: "high" },
      { title: "Production migration status", status: "blocked", note: "Must be resolved before finance can be considered usable.", priority: "high" }
    ]
  },
  {
    id: "integrations",
    title: "Integrations",
    summary: "Connected systems that make Mission Control operational instead of purely manual.",
    ownerArea: "Platform",
    nextAction: "Clarify each provider’s done definition and expose connection health consistently.",
    items: [
      { title: "Supabase auth/storage", status: "in_progress", note: "Auth works; storage buckets and limits need production verification.", priority: "high" },
      { title: "SendGrid", status: "in_progress", note: "Outbound/events exist; operational health needs continued QA.", priority: "high" },
      { title: "Jotform", status: "in_progress", note: "Intake works with mapping/replay; routing and history migration remain.", priority: "high" },
      { title: "Google Calendar", status: "planned", note: "Calendar invite creation/sync needs full end-to-end verification.", priority: "medium" },
      { title: "QuickBooks", status: "planned", note: "References/status first; full invoice sync later.", priority: "medium" },
      { title: "CRM handoff", status: "planned", note: "Outbound contact/registration sync is scoped.", priority: "medium" },
      { title: "Mux/resources", status: "planned", note: "Recording/resource workflows remain future-facing.", priority: "low" }
    ]
  },
  {
    id: "reports-analytics",
    title: "Reports / Analytics",
    summary: "Operational reporting, comparison views, finance summaries, and sharing/exporting.",
    ownerArea: "Reporting",
    nextAction: "Define the first must-have management report set after finance stabilizes.",
    items: [
      { title: "Operational reports", status: "in_progress", note: "Report surfaces exist and need sharper metrics.", priority: "medium" },
      { title: "Cohort comparison", status: "planned", note: "Comparison controls are planned for cohort charts.", priority: "medium" },
      { title: "Registration evolution", status: "in_progress", note: "Chart exists; needs subtler styling and filters.", priority: "medium" },
      { title: "Finance summaries", status: "blocked", note: "Depends on finance migration and distribution correctness.", priority: "high" },
      { title: "Export/share flows", status: "planned", note: "Shared report links exist; exports need definition.", priority: "low" }
    ]
  },
  {
    id: "platform-qa-deployment",
    title: "Platform / QA / Deployment",
    summary: "Quality gates, deployment safety, production audits, and environment readiness.",
    ownerArea: "Engineering",
    nextAction: "Add production DB migration access and keep Playwright audit reporting URL-specific failures.",
    items: [
      { title: "Typecheck/build/prepush", status: "done", note: "Standard QA commands are documented and used.", priority: "high" },
      { title: "Playwright audit", status: "in_progress", note: "Audit exists and reports layout/API issues; sandbox permissions affect local runs.", priority: "high" },
      { title: "Production audit", status: "in_progress", note: "Prod app can be checked with live credentials and curl/API probes.", priority: "high" },
      { title: "Migrations/deploy process", status: "blocked", note: "Prod DATABASE_URL/Vercel CLI access is needed to apply migrations reliably.", priority: "high" },
      { title: "Error visibility", status: "planned", note: "Need clearer server error reporting/log access.", priority: "medium" },
      { title: "Environment readiness", status: "in_progress", note: "Health checks exist; prod env completeness needs tightening.", priority: "medium" }
    ]
  }
];

function countItems(items: RoadmapItem[]) {
  return items.reduce<Record<RoadmapStatus, number>>(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { ...emptyCounts }
  );
}

function completionFor(items: RoadmapItem[]) {
  if (items.length === 0) {
    return 0;
  }

  const score = items.reduce((sum, item) => sum + statusWeight[item.status], 0);
  return Math.round((score / items.length) * 100);
}

function visualStatusFor(completion: number, counts: Record<RoadmapStatus, number>): RoadmapCardSummary["visualStatus"] {
  if (counts.blocked > 0 || completion < 35) {
    return "red";
  }

  if (completion >= 80) {
    return "green";
  }

  return "yellow";
}

export function buildRoadmapSummary(cards: RoadmapCard[] = roadmapCards): RoadmapSummary {
  const summarizedCards = cards.map((card) => {
    const counts = countItems(card.items);
    const completion = completionFor(card.items);
    return {
      ...card,
      counts,
      completion,
      visualStatus: visualStatusFor(completion, counts)
    };
  });
  const counts = summarizedCards.reduce<Record<RoadmapStatus, number>>(
    (acc, card) => {
      (Object.keys(card.counts) as RoadmapStatus[]).forEach((status) => {
        acc[status] += card.counts[status];
      });
      return acc;
    },
    { ...emptyCounts }
  );
  const totalItems = summarizedCards.reduce((sum, card) => sum + card.items.length, 0);
  const weightedScore = summarizedCards.reduce((sum, card) => sum + card.completion * card.items.length, 0);

  return {
    cards: summarizedCards,
    counts,
    totalItems,
    overallCompletion: totalItems > 0 ? Math.round(weightedScore / totalItems) : 0
  };
}
