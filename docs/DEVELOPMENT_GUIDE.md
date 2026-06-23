# Mission Control Development Guide

Read this guide and `docs/UI_GUIDE.md` before making app changes.

## Product Scope

- Mission Control is admin-only.
- Do not add learner dashboards, LaunchPad, learner course catalogs, community features, Asana sync, or Google Sheets sync.
- Mission Control replaces spreadsheet/project-board operations for cohort delivery.

## Engineering Rules

- Keep pages thin. Business logic belongs in services/modules.
- Use validators for incoming data and API mutations.
- Preserve existing service boundaries for Jotform, email, calendar, QuickBooks, CRM, Mux, audit, and operations tasks.
- Prefer structured parsing over ad hoc string handling.
- Do not expose server secrets or service-role credentials to client components.

## Admin UX Rules

- Admin workflows should explain the next action in plain language.
- Avoid raw JSON or provider payloads in visible product UI.
- Use dropdowns, expandable rows, and focused modals for operational tasks.
- Keep rows compact and actions consistent.

## QA Before Commit

Run these before committing or pushing:

```bash
pnpm typecheck
pnpm build
pnpm qa:prepush
```

If schema changes are included, also run:

```bash
pnpm prisma:generate
```

Production schema changes require applying the Prisma schema to Supabase before the deployed code can depend on new columns.

## Production Migration And Deployment Runbook

Use this flow for any feature that adds Prisma tables/columns, storage files, integrations, or production-only behavior.

1. Check local readiness:

```bash
pnpm prisma:generate
pnpm typecheck
pnpm build
pnpm qa:prepush
```

2. Review migration status before deploying:

```bash
pnpm prisma migrate status
```

3. Production deploys run the Vercel build command from `vercel.json`, which applies migrations and prepares Supabase buckets inside Vercel using production environment variables:

```bash
node scripts/apply-production-schema-patches.mjs
node scripts/ensure-storage-buckets.mjs
pnpm build
```

The schema patch script is idempotent and covers the current production backlog because this database was originally created before Prisma Migrate history existed. Do not run migrations from the app UI. For a manual emergency migration with direct database access and a baselined migration history, use:

```bash
pnpm prisma migrate deploy
```

4. Verify storage readiness in Supabase:

- public bucket: `mission-control-public` unless `SUPABASE_PUBLIC_BUCKET` overrides it
- private bucket: `mission-control-private` unless `SUPABASE_PRIVATE_BUCKET` overrides it
- private bucket supports invoices, receipts, materials, and email attachments up to 20MB per file

5. Deploy/push to `main`, then smoke test:

```bash
curl -sS https://mission-cohort-six.vercel.app/api/health
```

Also open these routes as an admin:

- `/dashboard`
- `/settings`
- `/communications`
- `/api/system-health`
- first cohort detail page

6. In **Settings > System Health**, confirm:

- Database is connected.
- Communications issue review is ready.
- Jotform revision history is ready.
- Invoice drafts are ready.
- Distribution ledger is ready.
- Public/private storage buckets are ready.
- SendGrid, Jotform, Supabase, and scheduled jobs show the expected status.

7. In **Settings > Connected Tools**, run the live integration diagnostics when changing email/calendar setup:

- `Send test email` sends a diagnostic email to the logged-in admin and verifies the SendGrid send path.
- `Test ICS fallback` confirms Mission Control can generate calendar invite files even without Google OAuth.
- `Test Google event` creates a diagnostic event on the configured Google Calendar after OAuth is connected.
- Cohort `Prepare Invites` uses Google automatically when connected, adds active participants from non-archived registrations as attendees, and asks Google to email all guests. ICS fallback prepares files only and must not be treated as a delivered invitation.
- Google access tokens are refreshed server-side from the saved refresh token. If refresh authorization is unavailable, reconnect Google Calendar from Connected Tools.
- Linked Google events update automatically when a session is edited. Cancellation uses Google Events delete with attendee updates enabled; single-session and full-cohort cancellations are available from the cohort Sessions surface and remain subject to the recipient safety allowlist.
- Calendar cancellation also sends an editable, tracked SendGrid notice using the `Session Cancellation` or `Cohort Cancellation` template. A prior calendar-only cancellation can send its notice later from the cohort Communications tab without touching Google Calendar again.
- Editing a linked session saves a pending provider change and reschedules unsent reminder records without notifying participants. Cohort `Apply Changes` updates every affected Google event with normal attendee notifications and sends one consolidated SendGrid summary. The production Vercel cron calls the scheduled-communications job every five minutes; `CRON_SECRET` secures that request.
- SendGrid and Google Calendar default to outbound safety mode. Cohort delivery is blocked unless every recipient is explicitly allowlisted in Connected Tools or a super admin intentionally enables live sending.
- Resetting cohort automation cancels only unsent/scheduled/failed communication records and clears ICS-only preparation. Sent history and Google event references are preserved to prevent hidden duplicate sends or cancellation notices.

If a feature shows `Blocked`, keep the UI compatibility fallback in place and do not mark the roadmap item done until production reports ready.

## Registration Communication Journeys

- Registration messaging is planned from one service regardless of whether the registration came from manual entry, participant maintenance, or Jotform intake.
- Every active registration gets a POC confirmation plan. Every registered participant gets a separate confirmation plus eligible one-month and one-week cohort milestones.
- Milestones already in the past when a participant is added are stored as `Skipped`, not sent late. Operators can see Draft, Scheduled, Sent, Skipped, and Failed records in registration quick view.
- POC communication history should render one condensed row per communication with delivery counts and issue chips. Do not show one row per SendGrid event in registration detail; raw recipient events belong in Communications.
- Draft cohorts may build journey records but cannot use normal live delivery. Publishing explicitly activates pending confirmations; Published and Active cohorts may deliver new-registration messages immediately. Draft delivery remains limited to the explicit allowlisted test mode.
- Journey keys are durable and unique by registration, recipient, and milestone so Jotform revisions or repeated edits do not create duplicate messages.
- Cancelling/archiving a registration, removing a participant, changing a participant email, or replacing a Jotform roster cancels that recipient's unsent journey records before any new plan is created.
- When a participant joins a Published or Active cohort, future linked Google events are refreshed so the new attendee receives the remaining calendar invitations.
- Existing W-9 and generated invoice documents are attached to the POC confirmation when available. Creating or revising invoices remains a separate finance workflow.
- Cohort publishing performs one cohort-level calendar preparation. Registration journey activation skips per-registration calendar refresh during that operation to prevent duplicate Google updates.

## Registration Roster Rules

- A newly created one-seat registration with no supplied roster defaults the POC to the participant in both manual and Jotform intake flows.
- Roster status is derived from saved participant records and the expected participant count. It is not a manually maintained registration field.
- If a legacy or team registration is missing its POC from the roster, registration quick view exposes `Add POC to roster` while an expected seat remains open.
- Increasing the expected participant count does not invent additional people; the roster remains Partial until those participant records are saved.
- Registration detail surfaces must show a roster and delivery preflight before operators apply changes: expected seats vs saved participants, whether the POC is on the participant roster, participant delivery recipients, pending add/remove impact, and any safety-mode recipient blockers.

## Registration Change Control

- Published and Active registration edits save to Mission Control immediately but defer attendee-facing delivery until an operator selects `Apply Changes` in registration quick view.
- A pending batch combines participant additions/removals with participant-count, total-amount, PO-number, and invoice-number changes. Repeated edits preserve the original value and latest value; reverting to the original removes that item from review.
- Applying a batch sends confirmations only to newly added participants, updates linked future Google events once per session, refreshes a simple one-line invoice/PDF when relevant, and sends one consolidated POC summary.
- Removed participants have unsent journey messages cancelled immediately, but Google attendee removal waits for Apply so multiple changes generate one coordinated update.
- Custom multi-line invoices are never rewritten automatically when seats or totals change. Apply remains pending and asks the operator to review the invoice first.
- Draft cohorts do not accumulate delivery batches because normal delivery is already blocked. Jotform intake remains an automatic registration path and does not use the manual edit batch.
- Partial Apply progress is stored in the pending envelope. Retrying does not repeat completed invoice, participant-journey, or calendar phases.

## Invoice Workbench

- Cohort `Distribution` is the finance home, but registration quick view must also expose linked invoice drafts so operators can create, edit, generate, open, and send documents without leaving the registration context.
- New invoice numbers default to `{thought-leader-code}-{organization-name}`, such as `KM-RIVERSIDE-SCHOOL-DISTRICT`, with a numeric suffix when a duplicate exists. Operators may still override the value before saving when finance needs a special case.
- Editing printable invoice fields, including line items, dates, PO number, status, paid amount, tax, notes, or invoice number, invalidates existing generated PDFs/receipts. Operators must regenerate the document after saving those changes.
- QuickBooks fields remain references/status only in v1. Editing QuickBooks reference fields must not invalidate generated PDFs.
- Invoice and receipt sends use Communications with the generated PDF attached and dedupe billing plus POC recipient emails.

## Registration Pricing And Attribution

- Registration totals auto-calculate from the selected cohort's `pricePerParticipant` times participant count.
- If a cohort does not have a configured price, Mission Control uses the central fallback matrix in `src/config/cohortPricing.ts` for 3-, 4-, 5-, and 8-session cohorts. Update that file intentionally when RocketPD pricing changes.
- Registration source display uses structured UTM fields first, then landing page, then source fallback. Raw provider labels such as `jotform` should not be the primary visible source when UTM or landing-page context exists.
- Legacy Docs/W-9/Invoice URL fields are not part of the primary registration editor. Generated invoice PDFs and receipts live in invoice drafts instead.
