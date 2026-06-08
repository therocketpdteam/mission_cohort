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
      { title: "Table and filter consistency", status: "in_progress", note: "Table System V2 is underway: quieter type, better width logic, and primary/context/detail cell patterns.", priority: "high" },
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
      { title: "Revenue watch", status: "in_progress", note: "Finance schema is healthy; continue QA on calculations and empty states.", priority: "high" },
      { title: "Attention items", status: "done", note: "Dashboard counts unreviewed communication issues and open operations tasks.", priority: "medium" },
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
      { title: "Sessions checklist", status: "done", note: "Overview uses a compact readiness checklist for calendar, default emails, and session materials.", priority: "high" },
      { title: "Registration/participant quick views", status: "in_progress", note: "Rows are clickable; history and edit affordances continue to improve.", priority: "high" },
      { title: "Materials/session resources", status: "in_progress", note: "Materials can be added directly to sessions and shown in the session checklist; attachment-to-email automation is next.", priority: "medium" },
      { title: "Publish-readiness workflow", status: "in_progress", note: "Checklist exists; automation and completion rules need tightening.", priority: "high" }
    ]
  },
  {
    id: "jotform-intake",
    title: "Jotform Intake",
    summary: "Webhook intake, review, mapping, replay, payment parsing, and submission history.",
    ownerArea: "Integrations",
    nextAction: "Keep hardening shared-form URL routing and reduce mapping ambiguity on real submissions.",
    items: [
      { title: "Webhook connection", status: "done", note: "Protected webhook URL and secret rotation are available.", priority: "high" },
      { title: "Review queue", status: "done", note: "Queue shows incoming submissions, processed state, readiness, and replay actions.", priority: "high" },
      { title: "Mapping wizard", status: "in_progress", note: "Cleaner UI exists; keep removing provider noise and ambiguous fields.", priority: "high" },
      { title: "URL routing", status: "in_progress", note: "URL rules and single-route fallback exist; shared-form edge cases remain.", priority: "high" },
      { title: "Replay", status: "done", note: "Held submissions can be replayed after mapping.", priority: "high" },
      { title: "Payment mapping", status: "done", note: "Explicit payment status and amount mapping are handled.", priority: "high" },
      { title: "Revision/history support", status: "done", note: "Production schema is healthy and linked Jotform revisions can be stored.", priority: "high" },
      { title: "Remaining routing edge cases", status: "planned", note: "Need clearer handling when Jotform sends generic source URLs.", priority: "medium" }
    ]
  },
  {
    id: "registrations-roster",
    title: "Registrations / Roster",
    summary: "Registration work queues, participant context, roster follow-up, and bulk operations.",
    ownerArea: "Operations",
    nextAction: "Deepen POC timeline and participant history inside quick views after the roster table cleanup.",
    items: [
      { title: "Registration quick view", status: "done", note: "Primary rows open an operational drawer with roster, Jotform revisions, POC history, and finance/source context.", priority: "high" },
      { title: "POC communication context", status: "done", note: "Registration detail links outbound history back to Communications.", priority: "high" },
      { title: "Roster/payment filters", status: "done", note: "Payment, roster, cohort, organization, source, and archive filters use the shared compact filter pattern.", priority: "medium" },
      { title: "Participant history", status: "done", note: "Participant detail now matches by email across cohorts for quick participation context.", priority: "medium" },
      { title: "Bulk actions", status: "done", note: "Registration and participant bulk status, certificate, archive/restore, and send-message actions are available from list views.", priority: "medium" },
      { title: "Attachments", status: "planned", note: "Needs private storage flow connected to communications.", priority: "medium" }
    ]
  },
  {
    id: "communications",
    title: "Communications",
    summary: "Email templates, scheduled/manual sends, delivery telemetry, and message issue visibility.",
    ownerArea: "Communications",
    nextAction: "Verify live SendGrid environment variables, then run a real send/resend/issue-review smoke test.",
    items: [
      { title: "Templates", status: "done", note: "Template management exists.", priority: "high" },
      { title: "Scheduled/manual emails", status: "in_progress", note: "All-cohort outbox and resend actions exist; live sending depends on SendGrid env readiness.", priority: "high" },
      { title: "Recipient issue review", status: "done", note: "Failed/bounced recipients can be reviewed with notes and removed from the active queue.", priority: "high" },
      { title: "SendGrid delivery/open/error telemetry", status: "in_progress", note: "Recipient timelines support events; production webhook key is still a health warning.", priority: "high" },
      { title: "Dashboard issue surfacing", status: "done", note: "Dashboard issue counts now track unreviewed failed/bounced recipients.", priority: "medium" },
      { title: "Outbound attachments", status: "in_progress", note: "Per-message attachments can be uploaded and removed; real send QA depends on SendGrid readiness.", priority: "high" },
      { title: "Future inbound reply sync", status: "planned", note: "Explicitly future scope.", priority: "low" }
    ]
  },
  {
    id: "finance-distribution",
    title: "Finance / Distribution",
    summary: "Payments, invoice drafts, receipts, TL distribution, and project return visibility.",
    ownerArea: "Finance",
    nextAction: "QA invoice/receipt sending in production once SendGrid env is configured, then decide the QuickBooks v2 sync scope.",
    items: [
      { title: "Payment snapshot", status: "done", note: "Payment summary is available on dashboard/cohort surfaces.", priority: "high" },
      { title: "Invoice drafts", status: "done", note: "Distribution now has a first-class editable invoice workbench with generated invoice numbers and line items.", priority: "high" },
      { title: "PDF invoices/receipts", status: "in_progress", note: "PDF generation/storage and send actions are wired; production send QA depends on SendGrid configuration.", priority: "high" },
      { title: "QuickBooks reference sync", status: "in_progress", note: "Refs/status are editable in v1; creating/updating QuickBooks invoices is future scope.", priority: "medium" },
      { title: "Distribution calculator", status: "done", note: "Sold, paid, RPD share, TL share, payout due, paid out, pending payout, and project return are calculated from active registrations.", priority: "high" },
      { title: "Payout ledger", status: "done", note: "Payout create/edit/cancel and proof upload are available inside Distribution.", priority: "high" },
      { title: "Production migration status", status: "done", note: "Finance and distribution schema checks are healthy in System Health.", priority: "high" }
    ]
  },
  {
    id: "integrations",
    title: "Integrations",
    summary: "Connected systems that make Mission Control operational instead of purely manual.",
    ownerArea: "Platform",
    nextAction: "Clarify each provider’s done definition and expose connection health consistently.",
    items: [
      { title: "Supabase auth/storage", status: "done", note: "Auth configuration and public/private storage buckets are healthy in production.", priority: "high" },
      { title: "SendGrid", status: "in_progress", note: "Outbound/events exist; operational health needs continued QA.", priority: "high" },
      { title: "Jotform", status: "in_progress", note: "Intake, mapping, replay, and revision schema work; shared-form routing edge cases remain.", priority: "high" },
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
      { title: "Finance summaries", status: "in_progress", note: "Finance schema is healthy; summary correctness and report UX need QA.", priority: "high" },
      { title: "Export/share flows", status: "planned", note: "Shared report links exist; exports need definition.", priority: "low" }
    ]
  },
  {
    id: "platform-qa-deployment",
    title: "Platform / QA / Deployment",
    summary: "Quality gates, deployment safety, production audits, and environment readiness.",
    ownerArea: "Engineering",
    nextAction: "Use Settings > System Health before and after deploys, then apply pending production migrations outside the app.",
    items: [
      { title: "Typecheck/build/prepush", status: "done", note: "Standard QA commands are documented and used.", priority: "high" },
      { title: "Playwright audit", status: "in_progress", note: "Audit exists and reports layout/API issues; sandbox permissions affect local runs.", priority: "high" },
      { title: "Production audit", status: "in_progress", note: "Prod app can be checked with live credentials and curl/API probes.", priority: "high" },
      { title: "System Health readiness panel", status: "done", note: "Settings now reports schema, storage, and integration readiness.", priority: "high" },
      { title: "Migrations/deploy process", status: "done", note: "Vercel build patches and readiness checks keep production schema drift visible.", priority: "high" },
      { title: "Error visibility", status: "done", note: "Schema lag returns controlled migration-required states in priority workflows.", priority: "medium" },
      { title: "Environment readiness", status: "in_progress", note: "System Health is live; SendGrid, Google Calendar, and QuickBooks still show env warnings.", priority: "medium" }
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
