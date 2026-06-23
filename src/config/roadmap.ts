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
    nextAction: "Verify Google/SendGrid production readiness on a live cohort, then keep simplifying cohort detail rows/actions.",
    items: [
      { title: "Lifecycle statuses", status: "done", note: "Operational status derives from readiness and session dates.", priority: "high" },
      { title: "Cohort thumbnails", status: "done", note: "Thumbnails upload and appear in cohort/dashboard contexts.", priority: "medium" },
      { title: "Overview/readiness", status: "done", note: "Basics and readiness are centered in Overview.", priority: "high" },
      { title: "Sessions checklist", status: "done", note: "Overview uses a compact readiness checklist for calendar, default emails, and session materials.", priority: "high" },
      { title: "Registration/participant quick views", status: "in_progress", note: "Rows are clickable; cohort registration detail now exposes the saved roster, derived status, POC fallback, and participant removal. History/edit affordances continue to improve.", priority: "high" },
      { title: "Materials/session resources", status: "done", note: "Materials remain optional session files and can be linked into outbound communications without blocking publication.", priority: "medium" },
      { title: "Publish-readiness workflow", status: "in_progress", note: "Draft cohorts prepare plans without live delivery; publishing explicitly authorizes calendar delivery and pending session edits use one Apply Changes workflow.", priority: "high" },
      { title: "Batch session change control", status: "done", note: "Linked session edits persist as pending changes, update affected Google events together, and create one consolidated communication record.", priority: "high" }
    ]
  },
  {
    id: "jotform-intake",
    title: "Jotform Intake",
    summary: "Webhook intake, review, mapping, replay, payment parsing, and submission history.",
    ownerArea: "Integrations",
    nextAction: "Run a live replay smoke test on a previously held shared-form submission, then tune any provider-specific field labels that still feel ambiguous.",
    items: [
      { title: "Webhook connection", status: "done", note: "Protected webhook URL and secret rotation are available.", priority: "high" },
      { title: "Review queue", status: "done", note: "Queue shows incoming submissions, processed state, readiness, and replay actions.", priority: "high" },
      { title: "Mapping wizard", status: "done", note: "Wizard has routing, confirmed mappings, readiness checks, and clean field previews.", priority: "high" },
      { title: "URL routing", status: "done", note: "Shared forms can route by landing page URL with a single-route fallback and replay blocking when route data is incomplete.", priority: "high" },
      { title: "Replay", status: "done", note: "Held submissions can be replayed after mapping, with clearer blockers for missing route/contact/organization data.", priority: "high" },
      { title: "Payment mapping", status: "done", note: "Explicit payment status and amount mapping are handled.", priority: "high" },
      { title: "Revision/history support", status: "done", note: "Production schema is healthy and linked Jotform revisions can be stored.", priority: "high" },
      { title: "Remaining routing edge cases", status: "in_progress", note: "Need live QA on provider-specific source URLs and older pending submissions.", priority: "medium" }
    ]
  },
  {
    id: "registrations-roster",
    title: "Registrations / Roster",
    summary: "Registration work queues, participant context, roster follow-up, and bulk operations.",
    ownerArea: "Operations",
    nextAction: "Deepen POC timeline and participant history inside quick views after the roster table cleanup.",
    items: [
      { title: "Registration quick view", status: "done", note: "Primary rows open an operational drawer with the actual saved roster, automatic roster health, POC fallback, Jotform revisions, POC history, and finance/source context.", priority: "high" },
      { title: "POC communication context", status: "done", note: "Registration detail links outbound history back to Communications.", priority: "high" },
      { title: "Roster/payment filters", status: "done", note: "Payment, roster, cohort, organization, source, and archive filters use the shared compact filter pattern.", priority: "medium" },
      { title: "Participant history", status: "done", note: "Participant detail now matches by email across cohorts for quick participation context.", priority: "medium" },
      { title: "Bulk actions", status: "done", note: "Registration and participant bulk status, certificate, archive/restore, and send-message actions are available from list views.", priority: "medium" },
      { title: "Registration change control", status: "done", note: "Published/Active participant and finance edits accumulate in one review batch, then coordinate participant confirmations, Google attendee updates, invoice refresh, and a consolidated POC summary.", priority: "high" },
      { title: "Attachments", status: "planned", note: "Needs private storage flow connected to communications.", priority: "medium" }
    ]
  },
  {
    id: "communications",
    title: "Communications",
    summary: "Email templates, scheduled/manual sends, delivery telemetry, and message issue visibility.",
    ownerArea: "Communications",
    nextAction: "Add participant/invoice revision notices, then connect the shared support inbox for reply history and response tasks.",
    items: [
      { title: "Templates", status: "done", note: "Template management exists.", priority: "high" },
      { title: "Scheduled/manual emails", status: "done", note: "All-cohort outbox, scheduled sends, diagnostics, resend actions, and live cohort delivery have been verified.", priority: "high" },
      { title: "Recipient issue review", status: "done", note: "Failed/bounced recipients can be reviewed with notes and removed from the active queue.", priority: "high" },
      { title: "SendGrid delivery/open/error telemetry", status: "in_progress", note: "Recipient timelines support events; production webhook key is still a health warning.", priority: "high" },
      { title: "Dashboard issue surfacing", status: "done", note: "Dashboard issue counts now track unreviewed failed/bounced recipients.", priority: "medium" },
      { title: "Outbound attachments", status: "done", note: "Per-message uploads, cohort/session material links, and live SendGrid delivery are available.", priority: "high" },
      { title: "Registration communication journeys", status: "in_progress", note: "POC/participant confirmations, milestone eligibility, calendar enrollment, visible timelines, and consolidated roster/invoice change delivery are implemented. Payment-policy and inbound-reply context remain.", priority: "high" },
      { title: "Shared inbound support inbox", status: "planned", note: "Connect support@rocketpd.com and its info@rocketpd.com alias, match contacts, preserve threads, and create response tasks.", priority: "high" }
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
      { title: "Invoice drafts", status: "done", note: "Distribution and registration quick view now expose editable invoice drafts with generated invoice numbers, line items, totals, PO, and accounting refs.", priority: "high" },
      { title: "PDF invoices/receipts", status: "in_progress", note: "PDF generation/storage, regeneration state, and send actions are wired; production send QA remains the last hardening step.", priority: "high" },
      { title: "QuickBooks reference sync", status: "in_progress", note: "Refs/status are editable in v1; creating/updating QuickBooks invoices is future scope.", priority: "medium" },
      { title: "Distribution calculator", status: "done", note: "Sold, paid, RPD share, TL share, payout due, paid out, pending payout, and project return are calculated from active registrations.", priority: "high" },
      { title: "Payout ledger", status: "done", note: "Payout create/edit/cancel and proof upload are available inside Distribution.", priority: "high" },
      { title: "Production migration status", status: "done", note: "Finance and distribution schema checks are healthy in System Health.", priority: "high" },
      { title: "Payment reminder policies", status: "planned", note: "Support standard, after-final-session, custom-date, and manual-hold reminder behavior per registration.", priority: "high" }
    ]
  },
  {
    id: "integrations",
    title: "Integrations",
    summary: "Connected systems that make Mission Control operational instead of purely manual.",
    ownerArea: "Platform",
    nextAction: "Keep provider health visible, then scope QuickBooks authorization and the shared inbound support inbox.",
    items: [
      { title: "Supabase auth/storage", status: "done", note: "Auth configuration and public/private storage buckets are healthy in production.", priority: "high" },
      { title: "SendGrid", status: "done", note: "App-managed setup, diagnostics, templates, live sends, consolidated change notices, and cancellation notices are operational.", priority: "high" },
      { title: "Jotform", status: "in_progress", note: "Intake, mapping, replay, and revision schema work; shared-form routing edge cases remain.", priority: "high" },
      { title: "Google Calendar", status: "done", note: "App-managed OAuth, diagnostics, attendee invitations, session updates, batch changes, and cancellation delivery have been verified live.", priority: "medium" },
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
    nextAction: "QA cohort registration PDF reports against live request examples, then add comparison and finance report templates.",
    items: [
      { title: "Operational reports", status: "in_progress", note: "Cohort registration report builder now covers filtered registration lists, snapshots, and outreach insight.", priority: "medium" },
      { title: "Cohort comparison", status: "planned", note: "Comparison controls are planned for cohort charts.", priority: "medium" },
      { title: "Registration evolution", status: "in_progress", note: "Chart exists; needs subtler styling and filters.", priority: "medium" },
      { title: "Finance summaries", status: "in_progress", note: "Finance schema is healthy; summary correctness and report UX need QA.", priority: "high" },
      { title: "Export/share flows", status: "in_progress", note: "Shared report links exist; registration reports now support print/save-to-PDF export.", priority: "low" }
    ]
  },
  {
    id: "platform-qa-deployment",
    title: "Platform / QA / Deployment",
    summary: "Quality gates, deployment safety, production audits, and environment readiness.",
    ownerArea: "Engineering",
    nextAction: "Use Settings > System Health and Connected Tools diagnostics before/after deploys, then apply pending production migrations outside the app.",
    items: [
      { title: "Typecheck/build/prepush", status: "done", note: "Standard QA commands are documented and used.", priority: "high" },
      { title: "Playwright audit", status: "in_progress", note: "Audit exists and reports layout/API issues; sandbox permissions affect local runs.", priority: "high" },
      { title: "Production audit", status: "in_progress", note: "Prod app can be checked with live credentials and curl/API probes.", priority: "high" },
      { title: "System Health readiness panel", status: "done", note: "Settings now reports schema, storage, and integration readiness.", priority: "high" },
      { title: "Migrations/deploy process", status: "done", note: "Vercel build patches and readiness checks keep production schema drift visible.", priority: "high" },
      { title: "Error visibility", status: "done", note: "Schema lag returns controlled migration-required states in priority workflows.", priority: "medium" },
      { title: "Environment readiness", status: "in_progress", note: "System Health is live and Connected Tools has SendGrid/calendar diagnostics; provider env warnings still need production cleanup.", priority: "medium" }
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
